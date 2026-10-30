import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { emptyProgress, fold, sessionDir, sessionFileName, type PiProgress } from './pisession'
import { parsePiCommand, parseStatus, type Task } from './pueue'
import { finishNotice, type TrackedTask } from './handoff'
import { daemonState, queueBadge } from './lifecycle'

export type HandoffState = { tasks: TrackedTask[]; available: boolean; selectedId?: number; showThinking?: boolean; showAll?: boolean; confirm?: { action: 'kill' | 'hold'; ids: number[]; atMs: number }; queue?: string; queueTasks?: Task[] }

const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [], available: true } satisfies HandoffState)
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)
let timer: { cancel(): void } | undefined
let polling = false

const liveState = (state: Task['state'] | undefined) => state === 'Queued' || state === 'Running' || state === 'Paused'
const isLive = (task: Task | undefined) => liveState(task?.state)
export const hasLiveTrackedTask = (tasks: readonly TrackedTask[]) => tasks.some(item => isLive(item.task))
const inside = (path: string, root: string) => path === root || path.startsWith(`${root}/`)

// A dispatch into a sibling worktree sits outside this session's cwd and root, so a task whose
// pueue label appears as a whole word in the dispatching command is this session's too.
const labelledIn = (command: string, label: string | undefined) =>
  !!label && command.split(/[\s"'=]+/).includes(label)

export const trackedFrom = (tasks: readonly Task[], startedMs: number, cwd: string, root: string, command = ''): TrackedTask[] =>
  tasks.flatMap(task => {
    const ours = inside(task.cwd, cwd) || inside(task.cwd, root) || labelledIn(command, task.label)
    if ((task.createdMs ?? -Infinity) < startedMs || !ours) return []
    const parsed = parsePiCommand(task.command)
    if (!parsed.model) return []
    return [{ id: task.id, cwd: task.cwd, addedMs: task.createdMs ?? startedMs, task, ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}), ...(task.label ?? parsed.label ? { label: task.label ?? parsed.label } : {}) }]
  })

// A task missing from the snapshot is dropped only when it was tracked before the snapshot was
// taken: one the tracker added while `pueue status` was running is simply not in it yet.
const mergeTasks = (old: readonly TrackedTask[], fresh: readonly Task[], nowMs: number, snapshotMs: number): TrackedTask[] => {
  const byId = new Map(fresh.map(task => [task.id, task]))
  return old.flatMap(item => {
    const task = byId.get(item.id)
    if (!task) return item.addedMs >= snapshotMs ? [item] : []
    const finishedMs = item.finishedMs ?? (isLive(task) ? undefined : nowMs)
    return [{ ...item, task, ...(finishedMs ? { finishedMs } : {}) }]
  })
}

const tail = async ($: EngineInterface, item: TrackedTask, current: PiProgress, home: string | undefined): Promise<PiProgress | undefined> => {
  if (!item.sessionId || !home) return undefined
  const dir = `${home}/.pi/agent/sessions/${sessionDir(item.cwd)}`
  const files = await $.fs.list(dir).catch(() => [])
  const name = files.find(file => file.kind === 'file' && sessionFileName(item.sessionId!).test(file.name))?.name
  if (!name) return undefined
  const path = `${dir}/${name}`
  const stat = await $.fs.stat(path).catch(() => undefined)
  if (!stat || stat.size <= current.offset) return undefined
  const from = current.offset > stat.size ? 0 : current.offset
  const result = await $.process.run(['tail', '-c', `+${from + 1}`, path])
  return result.exitCode === 0 ? fold(from === current.offset ? current : emptyProgress(), result.stdout) : undefined
}

async function poll($: EngineInterface) {
  if (polling) return
  polling = true
  try {
    const snapshotMs = await $.clock.now()
    const result = await $.process.run(['pueue', 'status', '--json'])
    const daemon = daemonState(result.exitCode, result.stdout)
    if (result.exitCode !== 0) {
      console.debug('session-band: pueue daemon unavailable')
      await update($, handoff, state => ({ ...state, available: false, queue: queueBadge(daemon, hasLiveTrackedTask(state.tasks)) }))
      return
    }
    const fresh = parseStatus(result.stdout)
    const nowMs = await $.clock.now()
    const before = new Map((await read($, handoff)).tasks.map(item => [item.id, item.task?.state]))
    // Merge inside the update so a task the tracker added meanwhile is not overwritten.
    await update($, handoff, value => {
      const tasks = mergeTasks(value.tasks, fresh, nowMs, snapshotMs)
      return { ...value, tasks, available: true, queue: queueBadge(daemon, hasLiveTrackedTask(tasks)), queueTasks: fresh }
    })
    const { tasks } = await read($, handoff)
    const home = await $.env.get('HOME')
    const existing = await read($, progress)
    const next = { ...existing }
    for (const item of tasks) {
      const updateProgress = await tail($, item, next[item.id] ?? emptyProgress(), home)
      if (updateProgress) next[item.id] = updateProgress
    }
    await update($, progress, () => next)
    // Act only on a transition this poller saw live: a repeat poll sees it finished in `before`.
    const ended = (await read($, handoff)).tasks.filter(item => liveState(before.get(item.id)) && !isLive(item.task))
    // A pick that finishes lets go, so the transcript follows the newest running task again.
    await update($, handoff, value => ended.some(item => item.id === value.selectedId) ? { ...value, selectedId: undefined } : value)
    for (const item of ended) {
      const notice = finishNotice(item, next[item.id] ?? existing[item.id])
      const sent = await $.ui.notify(notice, { title: 'Pi hand-off' }).catch(() => undefined)
      if (!sent?.isSent) await $.ui.toast(notice)
    }
    await syncTimer($)
  } finally {
    polling = false
  }
}

async function syncTimer($: EngineInterface) {
  const state = await read($, handoff)
  if (hasLiveTrackedTask(state.tasks)) {
    if (!timer) timer = $.clock.every(2_000, () => { void poll($) })
  } else if (timer) {
    timer.cancel()
    timer = undefined
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const startedMs = await $.clock.now()
    const result = await next(e)
    if ('deny' in result || !e.command.includes('pueue add')) return result
    const status = await $.process.run(['pueue', 'status', '--json']).catch(() => undefined)
    if (!status || status.exitCode !== 0) return result
    const [cwd, root, nowMs] = await Promise.all([$.session.cwd(), $.session.root(), $.clock.now()])
    const candidates = trackedFrom(parseStatus(status.stdout), startedMs, cwd, root, e.command)
    if (candidates.length > 0) {
      // A simultaneous session can race here; v1 intentionally accepts that narrow attribution race.
      await update($, handoff, state => ({ ...state, available: true, tasks: [...state.tasks, ...candidates.filter(candidate => !state.tasks.some(item => item.id === candidate.id))].map(item => item.task ? { ...item, task: item.task, finishedMs: isLive(item.task) ? item.finishedMs : nowMs } : item) }))
      await syncTimer($)
    }
    return result
  })

  on('ui.open', { id: 'pi-handoff' }, async ($, e, next) => {
    const result = await next(e)
    void poll($).catch(() => undefined)
    return result
  })
}

export const handoffAtom = handoff
export const progressAtom = progress
