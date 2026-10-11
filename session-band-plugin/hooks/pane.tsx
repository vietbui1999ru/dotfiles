import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { dispatchCommand, parseAddResult, parsePiCommand, parseStatus } from './pueue'
import { monitorRows, selectStale, type MonitorRow, type StaleSelection, type TrackedTask } from './handoff'
import type { HandoffState } from './handoff.tsx'
import { PALETTE } from './palette'
import type { PiProgress } from './pisession'
import { parsePending, type PendingReview } from './review'

const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [] as TrackedTask[], available: true } satisfies HandoffState)
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)
let aborting: number | undefined
let rejecting: string | undefined
type StaleDryRun = { selection: StaleSelection; atMs: number }

let stale: StaleDryRun | undefined

const complete = (task: TrackedTask) => ['Done', 'Failed', 'Killed'].includes(task.task?.state ?? '')
// The default prefers tasks with a Monitor row (`rowIds`), so the marked row and the controls
// agree; with no rows it falls back to any open task, so a long-finished one can still Continue.
export const selectedTask = (tasks: readonly TrackedTask[], selectedId?: number, rowIds?: readonly number[]): TrackedTask | undefined => {
  const open = tasks.filter(task => !task.dismissed)
  const shown = rowIds ? open.filter(task => rowIds.includes(task.id)) : open
  const newest = (list: readonly TrackedTask[]) => [...list].sort((left, right) => right.addedMs - left.addedMs)[0]
  return open.find(task => task.id === selectedId)
    ?? newest(shown.filter(task => task.task?.state === 'Running'))
    ?? newest(shown)
    ?? newest(open)
}
const taskLabel = (task: TrackedTask) => `pi#${task.id} ${task.task?.state ?? 'Other'}${task.label ? ` · ${task.label}` : ''}`

type MonitorField = 'modelEffort' | 'activity' | 'tokens' | 'cost'

export const monitorText = (row: MonitorRow, columns: number): string => {
  const fields: { name?: MonitorField; text: string }[] = [
    { text: `${row.glyph} #${row.id}` },
    ...(row.modelEffort ? [{ name: 'modelEffort' as const, text: row.modelEffort }] : []),
    { text: row.elapsed },
    { name: 'activity', text: row.activity },
    { name: 'tokens', text: row.tokens },
    { name: 'cost', text: row.cost },
    ...(row.label ? [{ text: row.label }] : []),
  ]
  const joined = () => fields.map(field => field.text).join(' ')
  for (const name of ['cost', 'tokens', 'modelEffort'] as const) {
    if (joined().length <= columns) break
    const index = fields.findIndex(field => field.name === name)
    if (index >= 0) fields.splice(index, 1)
  }
  const activity = fields.find(field => field.name === 'activity')
  if (activity && joined().length > columns) {
    const others = fields.filter(field => field !== activity).map(field => field.text).join(' ')
    const available = Math.max(1, columns - others.length - (others ? 1 : 0))
    activity.text = activity.text.length <= available ? activity.text : `${activity.text.slice(0, Math.max(0, available - 1))}…`
  }
  return joined()
}

export const selectedProgress = (tasks: readonly TrackedTask[], selectedId: number | undefined, allProgress: Readonly<Record<number, PiProgress>>, rowIds?: readonly number[]): PiProgress | undefined => {
  const task = selectedTask(tasks, selectedId, rowIds)
  return task ? allProgress[task.id] : undefined
}

export const hasMonitorRows = (rows: readonly MonitorRow[]): boolean => rows.length > 0

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
  // Quote-aware: a Continue's own command quotes the model, which a plain regex would keep.
  const parsed = task.task ? parsePiCommand(task.task.command) : {}
  return parsed.model ? [parsed.model, parsed.effort].filter(Boolean).join(':') : undefined
}

export const continueArgv = (task: TrackedTask, model: string | undefined, path: string): string[] | undefined =>
  model ? ['pueue', 'add', '-i', '--print-task-id', '--label', task.label ?? `continue-${task.id}`, '--', dispatchCommand(model, task.sessionId ?? '', path)] : undefined

export const continuePath = (tmp: string, sessionId: string, nowMs = Date.now()): string =>
  `${tmp.replace(/\/$/, '')}/pi-continue-${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}-${nowMs}.md`

async function continueTask($: EngineInterface, task: TrackedTask, pi: PiProgress | undefined, text: string) {
  if (!task.sessionId || text.trim() === '') return
  const model = continueModel(task, pi)
  if (!model) { await $.ui.toast('Cannot continue: model unknown'); return }
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const path = continuePath(tmp, task.sessionId)
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
  sockets.find(socket => socket.cwd === repo || socket.cwd.startsWith(`${repo}/`))?.path
export const reviewSplitArgv = (repo: string): string[] => ['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', repo]
export const reviewPaneRunArgv = (pane: string, socket: string): string[] => ['herdr', 'pane', 'run', pane, 'nvim', '--listen', socket]
export const approvalAction = (stdout: string, _stderr?: string): 'approved' | 'open-review' | 'refused' | 'unavailable' => {
  try {
    const reply = JSON.parse(stdout.trim()) as { ok?: boolean; reason?: string }
    if (reply.ok) return 'approved'
    return reply.reason === 'tree-changed' ? 'open-review' : 'refused'
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
export const approveArgv = (home: string, runId: string): string[] => [`${home}/dotfiles/scripts/agent-review`, 'approve', runId]
export const needsRejectConfirm = (current: string | undefined, runId: string): boolean => current !== runId
export const rejectToast = (exitCode: number): string =>
  exitCode === 0 ? 'Sent Reject all to Neovim; the decision appears in the band when recorded.' : 'Could not send Reject all to Neovim.'

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
  const home = await $.env.get('HOME')
  if (!home) { await $.ui.toast('Review gate not available.'); return }
  const result = await $.process.run(approveArgv(home, pending.runId), {
    cwd: await reviewRoot($, task.cwd),
    timeoutMs: 60_000,
  }).catch(() => undefined)
  const action = result ? approvalAction(result.stdout) : 'unavailable'
  if (action === 'unavailable') { await $.ui.toast('Review gate not available.'); return }
  if (action === 'approved') { await $.ui.toast('Review approved.'); return }
  let message: string | undefined
  try { message = (JSON.parse(result!.stdout) as { message?: string }).message } catch { /* outcome was already parsed */ }
  if (action === 'open-review') { await openReview($, task, message ?? 'Tree changed; opening review.'); return }
  await $.ui.toast(message ?? 'Review approval refused.')
}

async function rejectAll($: EngineInterface, task: TrackedTask, _pending: PendingReview, confirmed: boolean) {
  if (!confirmed) { await $.ui.toast('Press Reject all again to confirm.'); return false }
  try {
    const socket = await socketFor($, await reviewRoot($, task.cwd))
    const result = await $.process.run(reviewRemoteArgv(socket, 'AgentReviewRejectAll'))
    await $.ui.toast(rejectToast(result.exitCode))
    return result.exitCode === 0
  } catch {
    await $.ui.toast(rejectToast(1))
    return false
  }
}

const sameStaleSelection = (left: StaleSelection, right: StaleSelection) =>
  left.tasks.length === right.tasks.length
  && left.sessions.length === right.sessions.length
  && left.tasks.every(task => right.tasks.some(item => item.id === task.id))
  && left.sessions.every(session => right.sessions.some(item => item.path === session.path))

export const confirmedStale = (dryRun: StaleDryRun, current: StaleSelection, nowMs: number): StaleSelection | undefined =>
  nowMs - dryRun.atMs <= 60_000 && sameStaleSelection(dryRun.selection, current) ? current : undefined

async function staleSelection($: EngineInterface, state: { tasks: TrackedTask[] }): Promise<StaleSelection> {
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
  return selectStale(state.tasks, files, await $.clock.now())
}

async function cleanStale($: EngineInterface) {
  const state = await read($, handoff)
  const current = await staleSelection($, state)
  const nowMs = await $.clock.now()
  if (stale) {
    const selected = confirmedStale(stale, current, nowMs)
    const expired = nowMs - stale.atMs > 60_000
    stale = undefined
    if (!selected) { await $.ui.toast(expired ? 'Clean stale dry run expired; run it again.' : 'Clean stale selection changed; run a new dry run.'); return }
    for (const task of selected.tasks) await $.process.run(['pueue', 'remove', String(task.id)])
    for (const session of selected.sessions) await $.process.run(['rm', session.path])
    const ids = new Set(selected.tasks.map(task => task.id))
    await update($, handoff, value => ({ ...value, tasks: value.tasks.filter(task => !ids.has(task.id)) }))
    await $.ui.toast('Pi stale hand-offs removed')
    return
  }
  stale = { selection: current, atMs: nowMs }
  await $.ui.toast(`Clean stale dry run: ${current.tasks.length} tasks, ${current.sessions.length} sessions, ${current.bytes} B. Press again to remove.`)
}

export const register: Register = on => {
  on('command.run', { command: 'pi' }, async ($, _e, _next) => {
    await open($)
    return { text: 'Pi hand-off pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'pi-handoff' }, async ($, e, _next) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [state, allProgress, nowMs] = await Promise.all([read($, handoff), read($, progress), $.clock.now()])
    const rows = monitorRows(state.tasks, allProgress, state.tasks.flatMap(item => item.task ? [item.task] : []), nowMs)
    const rowIds = rows.map(row => row.id)
    const task = selectedTask(state.tasks, state.selectedId, rowIds)
    const pending = task ? await pendingFor($, task) : undefined
    const pi = selectedProgress(state.tasks, state.selectedId, allProgress, rowIds)
    const transcript = pi?.entries.slice(-200) ?? []
    return <Box flexDirection="column">
      {state.tasks.length === 0 && <Text>No Pi hand-offs tracked in this session.</Text>}
      {hasMonitorRows(rows) && <Box flexDirection="column">
        <Text>Monitor</Text>
        {rows.map(row => {
          const selected = row.id === task?.id
          const idle = row.idle?.text
          const columns = e.props.bodyColumns - (idle ? idle.length + 1 : 0) - 2
          return <Box key={`pi-monitor-${row.id}`} flexDirection="row">
            <Button key={`pi-row-${row.id}`} plain label={`${selected ? '› ' : '  '}${monitorText(row, columns)}`} onPress={() => void update($, handoff, value => ({ ...value, selectedId: row.id }))} />
            {idle && <Text color={PALETTE[row.idle!.tone]}>{` ${idle}`}</Text>}
          </Box>
        })}
      </Box>}
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
