import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { dispatchCommand, parseAddResult, parseStatus } from './pueue'
import { selectStale, type TrackedTask } from './handoff'
import type { HandoffState } from './handoff.tsx'
import type { PiProgress } from './pisession'
import { parsePending, type PendingReview } from './review'

const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [] as TrackedTask[], available: true } satisfies HandoffState)
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)
let aborting: number | undefined
let rejecting: string | undefined
let stale: ReturnType<typeof selectStale> | undefined
let continueCount = 0

const complete = (task: TrackedTask) => ['Done', 'Failed', 'Killed'].includes(task.task?.state ?? '')
export const selectedTask = (tasks: readonly TrackedTask[], selectedId?: number): TrackedTask | undefined => {
  const visible = tasks.filter(task => !task.dismissed)
  return visible.find(task => task.id === selectedId)
    ?? [...visible].filter(task => task.task?.state === 'Running').sort((left, right) => right.addedMs - left.addedMs)[0]
    ?? [...visible].sort((left, right) => right.addedMs - left.addedMs)[0]
}
const taskLabel = (task: TrackedTask) => `pi#${task.id} ${task.task?.state ?? 'Other'}${task.label ? ` · ${task.label}` : ''}`

async function open($: EngineInterface) {
  await $.ui.open({ id: 'pi-handoff', title: 'Pi hand-off', focus: true })
}

export const controlArgv = (task: TrackedTask, action: 'kill' | 'pause' | 'start' | 'remove'): string[] | undefined =>
  action === 'remove' && !complete(task) ? undefined : ['pueue', action, String(task.id)]

async function control($: EngineInterface, task: TrackedTask, action: 'kill' | 'pause' | 'start' | 'remove') {
  const argv = controlArgv(task, action)
  if (!argv) return
  await $.process.run(argv)
  if (action === 'remove') await update($, handoff, state => ({ ...state, tasks: state.tasks.filter(item => item.id !== task.id) }))
}

async function dismiss($: EngineInterface, task: TrackedTask) {
  await update($, handoff, state => ({ ...state, tasks: state.tasks.map(item => item.id === task.id ? { ...item, dismissed: true } : item) }))
}

export const continueModel = (task: TrackedTask, pi: PiProgress | undefined): string | undefined => {
  if (pi?.model) return [pi.model, pi.effort].filter(Boolean).join(':')
  const match = task.task?.command.match(/--model\s+([^\s]+)/)?.[1]
  return match
}

export const continueArgv = (task: TrackedTask, model: string | undefined, path: string): string[] | undefined =>
  model ? ['pueue', 'add', '-i', '--print-task-id', '--label', task.label ?? `continue-${task.id}`, '--', dispatchCommand(model, task.sessionId ?? '', path)] : undefined

async function continueTask($: EngineInterface, task: TrackedTask, pi: PiProgress | undefined, text: string) {
  if (!task.sessionId || text.trim() === '') return
  const model = continueModel(task, pi)
  if (!model) { await $.ui.toast('Cannot continue: model unknown'); return }
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const slug = task.sessionId.replace(/[^A-Za-z0-9_-]/g, '-')
  const path = `${tmp.replace(/\/$/, '')}/pi-continue-${slug}-${++continueCount}.md`
  await $.fs.write(path, text)
  const label = task.label ?? `continue-${task.id}`
  const result = await $.process.run(continueArgv(task, model, path)!)
  const id = parseAddResult(result.stdout)
  if (id === undefined) return
  const status = await $.process.run(['pueue', 'status', '--json'])
  const queued = parseStatus(status.stdout).find(item => item.id === id)
  const addedMs = await $.clock.now()
  await update($, handoff, state => ({ ...state, tasks: [...state.tasks, { id, cwd: task.cwd, addedMs, task: queued, sessionId: task.sessionId, label }] }))
}

async function reviewRoot($: EngineInterface, cwd: string): Promise<string> {
  const result = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : cwd
}

async function pendingFor($: EngineInterface, task: TrackedTask): Promise<PendingReview | undefined> {
  const dir = `${await reviewRoot($, task.cwd)}/.pi/agent-review/pending`
  const files = await $.fs.list(dir).catch(() => [])
  for (const file of files) {
    if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
    const pending = parsePending(await $.fs.read(`${dir}/${file.name}`).catch(() => ''))
    if (pending) return pending
  }
  return undefined
}

export const matchingSocket = (repo: string, sockets: readonly { path: string; cwd: string }[]): string | undefined =>
  sockets.find(socket => socket.cwd === repo || socket.cwd.startsWith(`${repo}/`) || repo.startsWith(`${socket.cwd}/`))?.path
export const reviewSplitArgv = (repo: string): string[] => ['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', repo]
export const reviewPaneRunArgv = (pane: string, socket: string): string[] => ['herdr', 'pane', 'run', pane, 'nvim', '--listen', socket]
export const approvalAction = (stdout: string, stderr = ''): 'approved' | 'open-review' | 'refused' | 'unavailable' => {
  if (/not found|ENOENT/i.test(stderr)) return 'unavailable'
  try {
    const reply = JSON.parse(stdout) as { ok?: boolean; reason?: string }
    return reply.ok ? 'approved' : reply.reason === 'tree-changed' ? 'open-review' : 'refused'
  } catch { return 'unavailable' }
}

async function socketFor($: EngineInterface, repo: string): Promise<string> {
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const user = await $.env.get('USER') ?? 'user'
  const found = await $.process.run(['fd', '-HI', '--type', 's', '^nvim\\..*\\.0$', `${tmp.replace(/\/$/, '')}/nvim.${user}`]).catch(() => ({ stdout: '' }))
  const candidates = [] as { path: string; cwd: string }[]
  for (const path of found.stdout.split('\n').filter(Boolean)) {
    const cwd = await $.process.run(['nvim', '--server', path, '--remote-expr', 'getcwd()'])
    if (cwd.exitCode === 0) candidates.push({ path, cwd: cwd.stdout.trim() })
  }
  const existing = matchingSocket(repo, candidates)
  if (existing) return existing
  const split = await $.process.run(reviewSplitArgv(repo))
  let pane: string | undefined
  try { pane = JSON.parse(split.stdout).result?.pane?.pane_id as string | undefined } catch { /* invalid herdr output is unavailable */ }
  if (!pane) throw new Error('could not open review pane')
  const socket = `${tmp.replace(/\/$/, '')}/nvim.${user}/pi-review-${Date.now()}.sock`
  await $.process.run(reviewPaneRunArgv(pane, socket))
  return socket
}

export const reviewRemoteArgv = (socket: string, command: 'AgentReview' | 'AgentReviewRejectAll'): string[] =>
  ['nvim', '--server', socket, '--remote-send', `<C-\\><C-N>:${command}<CR>`]
export const approveArgv = (runId: string): string[] => ['agent-review', 'approve', runId]
export const needsRejectConfirm = (current: string | undefined, runId: string): boolean => current !== runId

async function openReview($: EngineInterface, task: TrackedTask, message?: string) {
  try {
    const socket = await socketFor($, await reviewRoot($, task.cwd))
    await $.process.run(reviewRemoteArgv(socket, 'AgentReview'))
    if (message) await $.ui.toast(message)
  } catch {
    await $.ui.toast('Could not open review.')
  }
}

async function approve($: EngineInterface, task: TrackedTask, pending: PendingReview) {
  const result = await $.process.run(approveArgv(pending.runId)).catch(() => undefined)
  const action = result ? approvalAction(result.stdout, result.stderr) : 'unavailable'
  if (action === 'unavailable') { await $.ui.toast('Review gate not available.'); return }
  if (action === 'approved') { await $.ui.toast('Review approved.'); return }
  let message: string | undefined
  try { message = (JSON.parse(result!.stdout) as { message?: string }).message } catch { /* outcome was already parsed */ }
  if (action === 'open-review') { await openReview($, task, message ?? 'Tree changed; opening review.'); return }
  await $.ui.toast(message ?? 'Review approval refused.')
}

async function rejectAll($: EngineInterface, task: TrackedTask, pending: PendingReview, confirmed: boolean) {
  if (!confirmed) { await $.ui.toast('Press Reject all again to confirm.'); return false }
  const socket = await socketFor($, await reviewRoot($, task.cwd))
  await $.process.run(reviewRemoteArgv(socket, 'AgentReviewRejectAll'))
  await $.ui.toast(`Rejecting review ${pending.runId}.`)
  return true
}

async function cleanStale($: EngineInterface) {
  if (stale) {
    for (const task of stale.tasks) await $.process.run(['pueue', 'remove', String(task.id)])
    for (const session of stale.sessions) await $.process.run(['rm', session.path])
    const ids = new Set(stale.tasks.map(task => task.id))
    await update($, handoff, state => ({ ...state, tasks: state.tasks.filter(task => !ids.has(task.id)) }))
    stale = undefined
    await $.ui.toast('Pi stale hand-offs removed')
    return
  }
  const state = await read($, handoff)
  const home = await $.env.get('HOME')
  const files = [] as { path: string; name: string; mtimeMs: number; size: number }[]
  if (home) {
    for (const task of state.tasks) {
      if (!task.sessionId?.startsWith('pueue-')) continue
      const dir = `${home}/.pi/agent/sessions/--${task.cwd.replace(/^\/+/, '').replaceAll('/', '-')}--`
      const listed = await $.fs.list(dir).catch(() => [])
      for (const file of listed) if (file.kind === 'file' && file.name.endsWith(`_${task.sessionId}.jsonl`)) files.push({ path: `${dir}/${file.name}`, name: file.name, mtimeMs: file.mtimeMs, size: file.size })
    }
  }
  stale = selectStale(state.tasks, files, await $.clock.now())
  await $.ui.toast(`Clean stale dry run: ${stale.tasks.length} tasks, ${stale.sessions.length} sessions, ${stale.bytes} B. Press again to remove.`)
}

export const register: Register = on => {
  on('command.run', { command: 'pi' }, async ($, _e, _next) => {
    await open($)
    return { text: 'Pi hand-off pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'pi-handoff' }, async ($, e, _next) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [state, allProgress] = await Promise.all([read($, handoff), read($, progress)])
    const task = selectedTask(state.tasks, state.selectedId)
    const pending = task ? await pendingFor($, task) : undefined
    const pi = task ? allProgress[task.id] : undefined
    const transcript = pi?.entries.slice(-200) ?? []
    return <Box flexDirection="column">
      <Text>{state.tasks.length === 0 ? 'No Pi hand-offs tracked in this session.' : state.tasks.map(taskLabel).join('\n')}</Text>
      {task && <Text>{`\n${taskLabel(task)}${pi?.lastActivity ? ` · ${pi.lastActivity}` : ''}\n${pi ? `${pi.tokens} tokens · $${pi.cost.toFixed(3)}` : 'usage n/a'}`}</Text>}
      {transcript.map((entry, index) => <Text key={`entry-${index}`}>{entry.kind === 'error' ? `ERROR ${entry.text}` : entry.text.slice(0, 280)}</Text>)}
      {task && <Box>
        <Button key="pi-abort" onPress={() => { if (aborting === task.id) { aborting = undefined; void control($, task, 'kill') } else { aborting = task.id; void $.ui.toast('Press Abort again to confirm.') } }}>Abort</Button>
        <Button key="pi-pause" onPress={() => void control($, task, task.task?.state === 'Paused' ? 'start' : 'pause')}>{task.task?.state === 'Paused' ? 'Resume' : 'Pause'}</Button>
        {complete(task) && <Button key="pi-remove" onPress={() => void control($, task, 'remove')}>Remove</Button>}
        <Button key="pi-dismiss" onPress={() => void dismiss($, task)}>Dismiss</Button>
        {pending && <Button key="pi-open-review" onPress={() => void openReview($, task)}>Open review</Button>}
        {pending && <Button key="pi-approve" onPress={() => void approve($, task, pending)}>Approve</Button>}
        {pending && <Button key="pi-reject-all" onPress={() => { const confirmed = !needsRejectConfirm(rejecting, pending.runId); rejecting = confirmed ? undefined : pending.runId; void rejectAll($, task, pending, confirmed) }}>Reject all</Button>}
      </Box>}
      {task && <Input key="pi-continue" label="Continue" placeholder="Follow-up for Pi" submitLabel="send" onSubmit={value => void continueTask($, task, pi, value)} />}
      <Button key="pi-clean-stale" onPress={() => void cleanStale($)}>Clean stale</Button>
    </Box>
  })
}
