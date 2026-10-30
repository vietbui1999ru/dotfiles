import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { dispatchCommand, isTuiDispatch, parseAddResult, parsePiCommand, parseStatus, type Task } from './pueue'
import { controlArgv, eligible, holdArgv, parsePiArgs, PS_ARGV, releaseArgv, resolveTargets, signalGroupArgv, stopArgvs, strayGroups, type ControlAction, type Targets } from './controls'
import { monitorRows, runningPendingFor, selectStale, type MonitorRow, type StaleSelection, type TrackedTask } from './handoff'
import type { HandoffState } from './handoff.tsx'
import { focusRing, moveTo, type Motion } from './motion'
import { FOCUS_ACTION, FOCUS_REFUSED, JUMP_KEYS, nextPane, PANE_TITLES, switchSteps } from './pane-nav'
import { PALETTE } from './palette'
import type { PiProgress, TranscriptEntry } from './pisession'
import { parsePending, pendingRecordFor, type PendingReview } from './review'
import { diffHash, STUCK_MS, type CheckRecord, type OutcomeInputs } from './outcome'
import { editRefusal, killNote, parseEdit, readdArgv } from './lifecycle'

const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [] as TrackedTask[], available: true } satisfies HandoffState)
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)
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
    ...(row.pane ? [{ text: row.pane }] : []),
  ]
  const gap = '  '
  const joined = () => fields.map(field => field.text).join(gap)
  // The model always stays: it is how a row says which tier is working. Activity shrinks instead.
  for (const name of ['cost', 'tokens'] as const) {
    if (joined().length <= columns) break
    const index = fields.findIndex(field => field.name === name)
    if (index >= 0) fields.splice(index, 1)
  }
  const activity = fields.find(field => field.name === 'activity')
  if (activity && joined().length > columns) {
    const others = fields.filter(field => field !== activity).map(field => field.text).join(gap)
    const available = Math.max(1, columns - others.length - (others ? gap.length : 0))
    activity.text = activity.text.length <= available ? activity.text : `${activity.text.slice(0, Math.max(0, available - 1))}…`
  }
  return joined()
}

export const selectedProgress = (tasks: readonly TrackedTask[], selectedId: number | undefined, allProgress: Readonly<Record<number, PiProgress>>, rowIds?: readonly number[]): PiProgress | undefined => {
  const task = selectedTask(tasks, selectedId, rowIds)
  return task ? allProgress[task.id] : undefined
}

export const hasMonitorRows = (rows: readonly MonitorRow[]): boolean => rows.length > 0

/** What the row says about the run itself: the outcome, its round, and the review marker. */
export const outcomeLabel = (row: MonitorRow): string =>
  `${row.outcome}${row.round === undefined ? '' : ` ${row.round}/3`}${row.reviewWaiting ? ' · review' : ''}`

async function open($: EngineInterface) {
  await $.ui.open({ id: 'pi-handoff', title: 'Pi hand-off', focus: true })
}

const describeRefused = (refused: Targets['refused']) =>
  refused.length ? ` Skipped ${refused.map(item => `#${item.id} (${item.reason})`).join(', ')}.` : ''

/** Signal the detached tool groups of the given started tasks. The tree is intact while stopped, so strays still trace. */
async function signalStrays($: EngineInterface, ids: readonly number[], signal: 'STOP' | 'CONT') {
  const tasks = parseStatus((await $.process.run(['pueue', 'status', '--json'])).stdout)
  const commands = tasks.filter(task => ids.includes(task.id) && task.state !== 'Queued').map(task => task.command)
  if (commands.length === 0) return
  for (const pgid of strayGroups((await $.process.run(PS_ARGV)).stdout, commands)) await $.process.run(signalGroupArgv(signal, pgid))
}

/** Run one /pi control action, updating the tracked list for `rm`; returns the reply text. */
export async function runControl($: EngineInterface, action: ControlAction, ids: readonly number[], group: string): Promise<string> {
  // Each pueue call is checked: the reply must never claim what pueue refused.
  const run = async (argv: string[]) => {
    const result = await $.process.run(argv)
    if (result.exitCode === 0) return undefined
    return `${argv.slice(0, 2).join(' ')} failed: ${(result.stderr || result.stdout).trim().split('\n')[0] || `exit ${result.exitCode}`}`
  }
  const list = (items: readonly number[]) => items.map(id => `#${id}`).join(' ')
  if (action === 'release') return (await run(releaseArgv(group))) ?? `Queue ${group} released.`
  if (ids.length === 0) return 'Nothing to do.'
  if (action === 'kill' || action === 'hold') {
    if (action === 'hold') {
      const failed = await run(holdArgv(group))
      if (failed) return `${failed}. Nothing was killed.`
    }
    const status = await $.process.run(['pueue', 'status', '--json'])
    const tasks = parseStatus(status.stdout)
    const states = new Map(tasks.map(task => [task.id, task.state]))
    // Snapshot before the kill: afterwards the strays hang off launchd and no longer trace to the task.
    const commands = tasks.filter(task => ids.includes(task.id) && task.state !== 'Queued').map(task => task.command)
    const strays = commands.length ? strayGroups((await $.process.run(PS_ARGV)).stdout, commands) : []
    for (const argv of stopArgvs(ids, states)) {
      const failed = await run(argv)
      if (failed) return failed
    }
    // A group already gone exits 1 ("No such process"); nothing is left to kill then.
    for (const pgid of strays) await $.process.run(signalGroupArgv('KILL', pgid))
    const queued = ids.filter(id => states.get(id) === 'Queued')
    const started = ids.filter(id => states.get(id) !== 'Queued')
    const stopped = [started.length ? `Killed ${list(started)}` : '', queued.length ? `removed queued ${list(queued)}` : ''].filter(Boolean).join(', ')
    return action === 'hold' ? `Held queue ${group}. ${stopped}. Run /pi release to start the queue again.` : `${stopped}.`
  }
  const failed = await run(controlArgv(action, ids))
  if (failed) return failed
  if (action === 'pause' || action === 'resume') await signalStrays($, ids, action === 'pause' ? 'STOP' : 'CONT')
  if (action === 'rm') await update($, handoff, state => ({ ...state, tasks: state.tasks.filter(item => !ids.includes(item.id)) }))
  const verb = { pause: 'Paused', resume: 'Resumed', rm: 'Removed' }[action]
  return `${verb} ${list(ids)}.`
}

export const CONFIRM_MS = 60_000

/** Record a pending kill/hold in the handoff atom; the pane draws the confirm row from it. */
export async function askConfirm($: EngineInterface, action: 'kill' | 'hold', ids: number[]) {
  const atMs = await $.clock.now()
  await update($, handoff, state => ({ ...state, confirm: { action, ids, atMs } }))
}

/** Stop: the group starts nothing new; running tasks finish and queued ones wait. /pi release starts it again. */
async function stopQueue($: EngineInterface, group: string) {
  const result = await $.process.run(holdArgv(group))
  await $.ui.toast(result.exitCode === 0
    ? `Stopped queue ${group}; running tasks finish, queued tasks wait. Run /pi release to start it again.`
    : `pueue pause failed: ${(result.stderr || result.stdout).trim().split('\n')[0] || `exit ${result.exitCode}`}`)
}

/** Read-only: how much each killed task's worktree holds uncommitted. The band never reverts a worktree. */
async function uncommitted($: EngineInterface, tasks: readonly TrackedTask[], ids: readonly number[]): Promise<string> {
  const notes = [] as string[]
  for (const cwd of new Set(tasks.filter(task => ids.includes(task.id)).map(task => task.cwd))) {
    const status = await $.process.run(['git', '-C', cwd, 'status', '--porcelain']).catch(() => undefined)
    if (status?.exitCode === 0) notes.push(killNote(cwd, status.stdout))
  }
  return notes.join('')
}

/** Edit = remove and re-add with a new model and label. Remove goes first: pueue refuses to remove a started task, so a race cannot run it twice. */
async function editTask($: EngineInterface, task: TrackedTask, text: string) {
  const edit = parseEdit(text)
  if (!edit) return
  const live = parseStatus((await $.process.run(['pueue', 'status', '--json'])).stdout).find(item => item.id === task.id)
  const refused = editRefusal(live?.state)
  if (refused || !live) { await $.ui.toast(refused ?? 'Edit refused.'); return }
  const removed = await $.process.run(controlArgv('rm', [task.id]))
  if (removed.exitCode !== 0) { await $.ui.toast(`Edit refused: pueue would not remove #${task.id}.`); return }
  const label = edit.label ?? task.label ?? `edit-${task.id}`
  const added = await $.process.run(readdArgv(live, edit.model, label), { cwd: live.cwd })
  const id = parseAddResult(added.stdout)
  await update($, handoff, state => ({ ...state, selectedId: id ?? state.selectedId, tasks: state.tasks.flatMap(item => item.id !== task.id ? [item] : id === undefined ? [] : [{ ...item, id, label, task: { ...live, id, label } }]) }))
  await $.ui.toast(id === undefined
    ? `Removed #${task.id}, but the re-add failed: ${(added.stderr || added.stdout).trim() || `exit ${added.exitCode}`}`
    : `Edited #${task.id}: re-added as #${id} with ${edit.model}.`)
}

/** Re-read state, act only on ids still eligible; an expired or finished confirm does nothing. */
export async function confirmNow($: EngineInterface) {
  const state = await read($, handoff)
  const confirm = state.confirm
  await update($, handoff, value => ({ ...value, confirm: undefined }))
  if (!confirm) return
  if ((await $.clock.now()) - confirm.atMs > CONFIRM_MS) { await $.ui.toast('Confirmation expired; press again.'); return }
  const status = await $.process.run(['pueue', 'status', '--json'])
  const pueue = parseStatus(status.stdout)
  const { ids, refused } = resolveTargets(confirm.action, confirm.ids, state.tasks, pueue)
  if (ids.length === 0) { await $.ui.toast(`Nothing to ${confirm.action}.${describeRefused(refused)}`); return }
  const group = pueue.find(task => ids.includes(task.id))?.group ?? 'default'
  const reply = await runControl($, confirm.action, ids, group)
  await $.ui.toast(`${reply}${await uncommitted($, state.tasks, ids)}${describeRefused(refused)}`)
}

/** j/k/g: select the row the motion lands on and put the focus ring on it, so the two agree. */
async function move($: EngineInterface, rowIds: readonly number[], current: number | undefined, motion: Motion) {
  const to = moveTo(rowIds, current, motion)
  if (to === undefined) return
  await update($, handoff, value => ({ ...value, selectedId: to }))
  await focusRing($, 'pi-handoff', `pi-row-${to}`)
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

export const continueArgv = (task: TrackedTask, model: string, path: string): string[] =>
  ['pueue', 'add', '-i', '--print-task-id', '--label', task.label ?? `continue-${task.id}`, '--', dispatchCommand(model, task.sessionId ?? '', path)]

export const continuePath = (tmp: string, sessionId: string, nowMs = Date.now()): string =>
  `${tmp.replace(/\/$/, '')}/pi-continue-${sessionId.replace(/[^A-Za-z0-9_-]/g, '-')}-${nowMs}.md`

/** A `--tui` run's pane id lives here; `scripts/pi-view` writes it for every mode. */
export const tuiPanePath = (tmp: string, sessionId: string): string =>
  `${tmp.replace(/\/$/, '')}/pi-view/${sessionId}.pane`

/** Typed into Pi's own TUI: a steer while it works, a new prompt once it is idle. */
export const tuiSendArgvs = (pane: string, text: string): string[][] => [
  ['herdr', 'pane', 'send-text', pane, text],
  ['herdr', 'pane', 'send-keys', pane, 'Enter'],
]

/** Ctrl+D quits Pi, which ends the pueue task the pane belongs to. */
export const tuiCloseArgv = (pane: string): string[] => ['herdr', 'pane', 'send-keys', pane, 'ctrl+d']

/** `herdr agent focus` jumps to a pane in another tab; a bare pane id is its target. */
export const tuiFocusArgv = (pane: string): string[] => ['herdr', 'agent', 'focus', pane]

/** Where a run's pane sits, in the words the person uses for it. */
export const paneWhere = (tabId: string | undefined, label: string | undefined, dispatcherTabId: string | undefined): string => {
  if (!tabId) return 'unknown'
  if (dispatcherTabId && tabId === dispatcherTabId) return 'beside'
  if (label === 'verdict') return 'verdict'
  if (label === 'pi') return 'pi tab'
  return label ?? 'unknown'
}

async function continueTask($: EngineInterface, task: TrackedTask, pi: PiProgress | undefined, text: string) {
  if (!task.sessionId || text.trim() === '') return
  // A --tui run reads the text in Pi itself instead of a fresh dispatch.
  const pane = await tuiPane($, task)
  if (pane) {
    for (const argv of tuiSendArgvs(pane, text)) {
      const sent = await $.process.run(argv).catch(() => undefined)
      if (!sent || sent.exitCode !== 0) {
        await $.ui.toast(`Could not reach the Pi pane ${pane}; the run keeps going.`)
        return
      }
    }
    return
  }
  const model = continueModel(task, pi)
  if (!model) { await $.ui.toast('Cannot continue: model unknown'); return }
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const path = continuePath(tmp, task.sessionId)
  await $.fs.write(path, text)
  const label = task.label ?? `continue-${task.id}`
  const result = await $.process.run(continueArgv(task, model, path))
  const id = parseAddResult(result.stdout)
  if (id === undefined) return
  const status = await $.process.run(['pueue', 'status', '--json'])
  const queued = parseStatus(status.stdout).find(item => item.id === id)
  const addedMs = await $.clock.now()
  await update($, handoff, state => ({ ...state, tasks: [...state.tasks, { id, cwd: task.cwd, addedMs, task: queued, sessionId: task.sessionId, label }] }))
}

/** The pane of a running `--tui` run, read from the file `scripts/pi-view` writes. */
async function tuiPane($: EngineInterface, task: TrackedTask): Promise<string | undefined> {
  const live = task.task
  if (!live || live.state !== 'Running' || !isTuiDispatch(live.command)) return undefined
  const sessionId = task.sessionId ?? parsePiCommand(live.command).sessionId
  if (!sessionId) return undefined
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const pane = (await $.fs.read(tuiPanePath(tmp, sessionId)).catch(() => '')).trim().split('\n')[0]
  return pane ? pane : undefined
}

/** One herdr pane, or undefined when herdr does not know it: a closed pane answers nothing. */
async function herdrPane($: EngineInterface, pane: string): Promise<{ tab_id?: string } | undefined> {
  const result = await $.process.run(['herdr', 'pane', 'get', pane]).catch(() => undefined)
  if (!result || result.exitCode !== 0) return undefined
  try {
    const parsed = JSON.parse(result.stdout) as { result?: { pane?: { tab_id?: string } } }
    return parsed.result?.pane
  } catch {
    return undefined
  }
}

/** `beside`, `verdict`, `pi tab`, or the pane's own tab label, from herdr's tab list. */
async function tuiWhere($: EngineInterface, pane: string): Promise<string | undefined> {
  const info = await herdrPane($, pane)
  if (!info?.tab_id) return undefined
  const listed = await $.process.run(['herdr', 'tab', 'list']).catch(() => undefined)
  let label: string | undefined
  if (listed?.exitCode === 0) {
    try {
      const parsed = JSON.parse(listed.stdout) as { result?: { tabs?: { tab_id?: string; label?: string }[] } }
      label = parsed.result?.tabs?.find(tab => tab.tab_id === info.tab_id)?.label
    } catch {
      label = undefined
    }
  }
  return paneWhere(info.tab_id, label, await $.env.get('HERDR_TAB_ID') ?? undefined)
}

/** `herdr agent focus` jumps across tabs; a pane herdr does not call an agent still has a tab. */
async function focusTuiPane($: EngineInterface, pane: string) {
  const focused = await $.process.run(tuiFocusArgv(pane)).catch(() => undefined)
  if (focused?.exitCode === 0) return
  const info = await herdrPane($, pane)
  if (info?.tab_id) await $.process.run(['herdr', 'tab', 'focus', info.tab_id]).catch(() => undefined)
}

/** Ctrl+D ends the run through Pi itself; a Pi that does not quit falls back to the kill path. */
async function closeTuiRun($: EngineInterface, task: TrackedTask, pane: string) {
  const group = task.task?.group ?? 'default'
  const sent = await $.process.run(tuiCloseArgv(pane)).catch(() => undefined)
  if (!sent || sent.exitCode !== 0) {
    await $.ui.toast(await runControl($, 'kill', [task.id], group))
    return
  }
  let timer: { cancel(): void } | undefined
  timer = $.clock.every(5_000, () => {
    timer?.cancel()
    void (async () => {
      const status = await $.process.run(['pueue', 'status', '--json']).catch(() => undefined)
      const live = status ? parseStatus(status.stdout).find(item => item.id === task.id) : undefined
      if (live?.state === 'Running' || live?.state === 'Paused') await runControl($, 'kill', [task.id], group)
    })()
  })
}

async function reviewRoot($: EngineInterface, cwd: string): Promise<string> {
  const result = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : cwd
}

async function pendingRecordsFor($: EngineInterface, root: string): Promise<PendingReview[]> {
  const dir = `${root}/.pi/agent-review/pending`
  const files = await $.fs.list(dir).catch(() => [])
  const records = [] as PendingReview[]
  for (const file of files) {
    if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
    const pending = parsePending(await $.fs.read(`${dir}/${file.name}`).catch(() => ''))
    if (pending) records.push(pending)
  }
  return records
}

async function pendingFor($: EngineInterface, task: TrackedTask): Promise<PendingReview | undefined> {
  return pendingRecordFor(task, await pendingRecordsFor($, await reviewRoot($, task.cwd)))
}

/** The saved check record `pi-checks` writes per dispatch. */
async function checkRecord($: EngineInterface, home: string, sessionId: string | undefined): Promise<CheckRecord | undefined> {
  if (!sessionId) return undefined
  const raw = await $.fs.read(`${home}/.local/state/pi-checks/${sessionId}.json`).catch(() => '')
  try {
    const value = JSON.parse(raw) as Partial<CheckRecord>
    return typeof value.phase === 'string' && typeof value.commit === 'string' && typeof value.diffHash === 'string'
      && typeof value.specStatus === 'string' && typeof value.round === 'number' && typeof value.steered === 'boolean'
      ? value as CheckRecord : undefined
  } catch { return undefined }
}

/** HEAD and a hash of the uncommitted diff: the two facts that make a saved result current. */
async function headOf($: EngineInterface, cwd: string): Promise<{ commit: string; diffHash: string } | undefined> {
  const commit = await $.process.run(['git', 'rev-parse', 'HEAD'], { cwd }).catch(() => undefined)
  if (!commit || commit.exitCode !== 0) return undefined
  const diff = await $.process.run(['git', 'diff', 'HEAD'], { cwd }).catch(() => undefined)
  if (!diff || diff.exitCode !== 0) return undefined
  return { commit: commit.stdout.trim(), diffHash: diffHash(diff.stdout) }
}

/** A running `--tui` run's herdr agent status; no pane, or a closed one, is `undefined`. */
async function agentStatus($: EngineInterface, sessionId: string | undefined): Promise<string | undefined> {
  if (!sessionId) return undefined
  let tmp = '/tmp'
  try { tmp = await $.env.get('TMPDIR') ?? '/tmp' } catch { /* no environment in some harnesses */ }
  const pane = (await $.fs.read(tuiPanePath(tmp, sessionId)).catch(() => '')).trim().split('\n')[0]
  if (!pane) return undefined
  const got = await $.process.run(['herdr', 'pane', 'get', pane]).catch(() => undefined)
  if (!got || got.exitCode !== 0) return undefined
  try { return (JSON.parse(got.stdout) as { result?: { pane?: { agent_status?: string } } }).result?.pane?.agent_status } catch { return undefined }
}

/**
 * What `deriveOutcome` needs from beyond pueue's own state, per tracked task. The costly
 * calls happen only when they can change the answer: git for a saved record, herdr after
 * ten silent minutes.
 */
async function outcomeInputsFor(
  $: EngineInterface,
  tracked: readonly TrackedTask[],
  tasks: readonly Task[],
  progress: Readonly<Record<number, PiProgress | undefined>>,
  nowMs: number,
): Promise<Record<number, Omit<OutcomeInputs, 'pueue'>>> {
  const current = new Map(tasks.map(task => [task.id, task]))
  let home: string | undefined
  try { home = await $.env.get('HOME') } catch { /* no environment in some harnesses */ }
  const inputs: Record<number, Omit<OutcomeInputs, 'pueue'>> = {}
  // Several runs can share one worktree, so its pending directory is read once per redraw.
  const pendingByRoot = new Map<string, PendingReview[]>()
  const pendingIn = async (root: string) => {
    const known = pendingByRoot.get(root)
    if (known) return known
    const records = await pendingRecordsFor($, root)
    pendingByRoot.set(root, records)
    return records
  }
  for (const item of tracked) {
    const task = current.get(item.id) ?? item.task
    if (!task) continue
    // A --tui run keeps Running while its review waits, so a running run's own record counts too.
    const records = await pendingIn(await reviewRoot($, task.cwd))
    const ended = task.state === 'Done' || task.state === 'Failed' || task.state === 'Killed'
    const pending = ended ? pendingRecordFor({ ...item, task }, records) : runningPendingFor(item, records)
    const value: Omit<OutcomeInputs, 'pueue'> = { reviewPending: pending !== undefined }
    const lastEventMs = progress[item.id]?.lastEventMs
    if (lastEventMs !== undefined) value.logAgeMs = Math.max(0, nowMs - lastEventMs)
    const check = home ? await checkRecord($, home, item.sessionId) : undefined
    if (check) {
      value.check = check
      const head = await headOf($, task.cwd)
      if (head) value.head = head
    }
    if (task.state === 'Running' && value.logAgeMs !== undefined && value.logAgeMs >= STUCK_MS) {
      const status = await agentStatus($, item.sessionId)
      if (status !== undefined) value.agentStatus = status
    }
    inputs[item.id] = value
  }
  return inputs
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

async function waitForSocket($: EngineInterface, socket: string): Promise<boolean> {
  if (await $.fs.exists(socket)) return true
  return new Promise(resolve => {
    let attempts = 0
    const timer = $.clock.every(100, async () => {
      const exists = await $.fs.exists(socket)
      attempts += 1
      if (exists || attempts >= 30) {
        timer.cancel()
        resolve(exists)
      }
    })
  })
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
  if (await waitForSocket($, socket)) return socket
  throw new Error('review Neovim did not start')
}

export const reviewRemoteArgv = (socket: string, command: 'AgentReview' | 'AgentReviewRejectAll', runId?: string): string[] =>
  ['nvim', '--server', socket, '--remote-send', `<C-\\><C-N>:${command}${command === 'AgentReviewRejectAll' && runId ? ` ${runId}` : ''}<CR>`]
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

async function rejectAll($: EngineInterface, task: TrackedTask, runId: string, confirmed: boolean) {
  if (!confirmed) { await $.ui.toast('Press Reject all again to confirm.'); return false }
  try {
    const socket = await socketFor($, await reviewRoot($, task.cwd))
    const result = await $.process.run(reviewRemoteArgv(socket, 'AgentReviewRejectAll', runId))
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

// `$` cannot cross an import, so this pane runs pane-nav's switch itself.
const goTo = async ($: EngineInterface, to: string | undefined) => {
  for (const s of switchSteps('pi-handoff', to)) await ('close' in s ? $.ui.close({ id: s.close }) : $.ui.open({ id: s.open, title: s.title, focus: s.focus }))
}
const cycle = async ($: EngineInterface, step: 1 | -1) => goTo($, nextPane((await $.ui.panes()).map(pane => pane.id), 'pi-handoff', step))

// Keep engine calls local: `$` cannot cross an import.
async function focusSelf($: EngineInterface) {
  if ((await $.prompt.read()).text.trim()) {
    await $.ui.toast(FOCUS_REFUSED)
    return
  }
  await $.ui.open({ id: 'pi-handoff', title: PANE_TITLES['pi-handoff'], focus: true })
  if (!(await $.ui.panes()).some(pane => pane.id === 'pi-handoff' && pane.isFocused)) await $.ui.toast(FOCUS_REFUSED)
}

export const transcriptLines = (entries: readonly TranscriptEntry[], showThinking: boolean): { key: string; text: string; dim: boolean }[] =>
  entries.flatMap((entry, index) => {
    if (entry.kind === 'thinking' && !showThinking) return []
    if (entry.kind === 'thinking') return [{ key: `entry-${index}`, text: entry.text ? `  · ${entry.text}` : '  · thinking…', dim: true }]
    if (entry.kind === 'text') return [{ key: `entry-${index}`, text: entry.text.slice(0, 280), dim: false }]
    if (entry.kind === 'tool') return [{ key: `entry-${index}`, text: entry.text, dim: false }]
    if (entry.kind === 'error') return [{ key: `entry-${index}`, text: `ERROR ${entry.text}`, dim: false }]
    return entry.text.split('\n').map((line, lineIndex) => ({ key: `entry-${index}-${lineIndex}`, text: `  ↳ ${line}`, dim: true }))
  })

/** The all view: `rows` shared evenly across the tasks, one row each for its header, never fewer than 3 lines. */
export const stackedSections = (ids: readonly number[], allProgress: Readonly<Record<number, PiProgress | undefined>>, showThinking: boolean, rows: number) => {
  const per = Math.max(3, Math.floor(rows / Math.max(1, ids.length)) - 1)
  return ids.map(id => ({ id, lines: transcriptLines(allProgress[id]?.entries ?? [], showThinking).slice(-per) }))
}

export const register: Register = on => {
  on('command.run', { command: 'pi' }, async ($, e, _next) => {
    const parsed = parsePiArgs(e.args)
    if (parsed.kind === 'open') { await open($); return { text: 'Pi hand-off pane opened.' } }
    if (parsed.kind === 'error') return { text: parsed.text }
    const status = await $.process.run(['pueue', 'status', '--json'])
    if (status.exitCode !== 0) return { text: 'pueue daemon unavailable.' }
    const pueue = parseStatus(status.stdout)
    const state = await read($, handoff)
    const selected = selectedTask(state.tasks, state.selectedId)?.id
    const { ids, refused } = resolveTargets(parsed.action, parsed.target, state.tasks, pueue, selected)
    if (parsed.target === 'all' && parsed.action !== 'release' && ids.length > 0 && (parsed.action === 'kill' || parsed.action === 'hold')) {
      const nowMs = await $.clock.now()
      await update($, handoff, value => ({ ...value, confirm: { action: parsed.action, ids, atMs: nowMs } }))
      await open($)
      return { text: `Press Kill in the Pi hand-off pane to confirm ${parsed.action} of ${ids.map(id => `#${id}`).join(' ')}.` }
    }
    const group = pueue.find(task => ids.includes(task.id))?.group ?? 'default'
    if (ids.length === 0 && parsed.action !== 'release') return { text: `Nothing to ${parsed.action}.${describeRefused(refused)}` }
    return { text: `${await runControl($, parsed.action, ids, group)}${describeRefused(refused)}` }
  })

  on('ui.render', { component: 'Pane', requestId: 'pi-handoff' }, async ($, e, _next) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [state, allProgress, nowMs] = await Promise.all([read($, handoff), read($, progress), $.clock.now()])
    const taskList = state.tasks.flatMap(item => item.task ? [item.task] : [])
    const inputs = await outcomeInputsFor($, state.tasks, taskList, allProgress, nowMs)
    const base = monitorRows(state.tasks, allProgress, taskList, nowMs, undefined, inputs)
    const rowIds = base.map(row => row.id)
    const task = selectedTask(state.tasks, state.selectedId, rowIds)
    // Only the selected run's pane is asked about, so a redraw costs no herdr calls for the rest.
    const pane = task ? await tuiPane($, task) : undefined
    const where = pane ? await tuiWhere($, pane) : undefined
    let rows = base
    if (where && task) rows = monitorRows(state.tasks, allProgress, taskList, nowMs, { [task.id]: where }, inputs)
    const pending = task ? await pendingFor($, task) : undefined
    const pi = selectedProgress(state.tasks, state.selectedId, allProgress, rowIds)
    const transcript = pi?.entries.slice(-200) ?? []
    const confirm = state.confirm && nowMs - state.confirm.atMs <= CONFIRM_MS ? state.confirm : undefined
    // The all view stacks every working task's transcript; the rows left after the strip and monitor are shared out.
    const working = rowIds.flatMap(id => state.tasks.filter(item => item.id === id && (item.task?.state === 'Running' || item.task?.state === 'Paused')))
    const sections = state.showAll && working.length > 0
      ? stackedSections(working.map(item => item.id), allProgress, state.showThinking ?? false, e.props.scroll.bodyRows - rows.length - 8)
      : undefined
    return <Box flexDirection="column">
      {state.tasks.length === 0 && <Text>No Pi hand-offs tracked in this session.</Text>}
      {/* Hotkeys, not hints: a key the pane does not bind falls through to the composer. */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="pi-key-down" plain dimColor hotkey="j" label={'\uF063'} onPress={() => void move($, rowIds, task?.id, 'down')} />
        <Button key="pi-key-up" plain dimColor hotkey="k" label={'\uF062'} onPress={() => void move($, rowIds, task?.id, 'up')} />
        <Button key="pi-key-top" plain dimColor hotkey="g" label={'\uF102'} onPress={() => void move($, rowIds, task?.id, 'top')} />
        <Button key="pi-key-insert" plain dimColor hotkey="i" label={'\uF040'} onPress={() => { if (task) void focusRing($, 'pi-handoff', 'pi-continue') }} />
        <Button key="pi-key-reload" plain dimColor hotkey="r" label={'\uF021'} onPress={() => void open($)} />
        <Button key="pi-key-prev" plain dimColor hotkey="b" label={'\uF053'} onPress={() => void cycle($, -1)} />
        <Button key="pi-key-next" plain dimColor hotkey="f" label={'\uF054'} onPress={() => void cycle($, 1)} />
        <Button key="pi-key-quit" plain dimColor hotkey="q" label={'\uF00D'} onPress={() => void $.ui.close({ id: 'pi-handoff' })} />
        <Button key="pi-key-focus" plain dimColor action={FOCUS_ACTION} label="ctrl+x b" onPress={() => void focusSelf($)} />
        <Button key="pi-key-thinking" plain dimColor hotkey="t" label={state.showThinking ? '\uF0E5' : '\uF075'} onPress={() => void update($, handoff, value => ({ ...value, showThinking: !value.showThinking }))} />
        <Button key="pi-key-all" plain dimColor hotkey="v" label={state.showAll ? '\uF096' : '\uF00B'} onPress={() => void update($, handoff, value => ({ ...value, showAll: !value.showAll }))} />
        {pane && <Button key="pi-tui-focus" plain dimColor hotkey="o" label={'\uF08E'} onPress={() => void focusTuiPane($, pane)} />}
        {pane && task && <Button key="pi-tui-close" plain dimColor label={'\uF08B'} onPress={() => void closeTuiRun($, task, pane)} />}
        {JUMP_KEYS.map(j => <Button key={`pi-key-jump-${j.key}`} plain dimColor hotkey={j.key} label={j.label} onPress={() => void (j.id === 'pi-handoff' ? undefined : goTo($, j.id))} />)}
        {task && <Text dimColor>x kill  s stop  h hold  p pause  y/n confirm</Text>}
        {(!task || complete(task)) && <Button key="pi-key-abort" plain dimColor hotkey="x" label={'\uF057'} onPress={() => undefined} />}
        {(!task?.task || !eligible('kill', task.task.state)) && <Button key="pi-key-hold" plain dimColor hotkey="h" label={'\uF28B'} onPress={() => undefined} />}
        {(!task || complete(task)) && <Button key="pi-key-pause" plain dimColor hotkey="p" label={'\uF04C'} onPress={() => undefined} />}
        {(!task?.task || !eligible('pause', task.task.state)) && <Button key="pi-key-stop" plain dimColor hotkey="s" label={'\uF04D'} onPress={() => undefined} />}
        {!confirm && <Button key="pi-key-yes" plain dimColor hotkey="y" label={'\uF00C'} onPress={() => undefined} />}
        {!confirm && <Button key="pi-key-no" plain dimColor hotkey="n" label={'\uF05E'} onPress={() => undefined} />}
      </Box>
      {confirm && <Box flexDirection="row" columnGap={1}>
        <Text color={PALETTE.red}>{`${confirm.action === 'hold' ? 'Hold queue and kill' : 'Kill'} ${confirm.ids.map(id => `#${id}`).join(' ')}?`}</Text>
        <Button key="pi-confirm-ok" hotkey="y" onPress={() => void confirmNow($)}>{confirm.action === 'hold' ? 'Hold + kill' : 'Kill'}</Button>
        <Button key="pi-confirm-cancel" hotkey="n" onPress={() => void update($, handoff, value => ({ ...value, confirm: undefined }))}>Cancel</Button>
      </Box>}
      {hasMonitorRows(rows) && <Box flexDirection="column">
        <Text>Monitor</Text>
        {rows.map(row => {
          const selected = row.id === task?.id
          const idle = row.idle?.text
          const outcome = ` ${outcomeLabel(row)}`
          const columns = e.props.bodyColumns - (idle ? idle.length + 1 : 0) - 2 - outcome.length
          // The row is its only focus stop, so ↑↓ move one row; x/p act on the selected row.
          return <Box key={`pi-monitor-${row.id}`} flexDirection="row">
            <Button key={`pi-row-${row.id}`} plain label={`${selected ? '› ' : '  '}${monitorText(row, columns)}`} onPress={() => void update($, handoff, value => ({ ...value, selectedId: row.id }))} />
            <Text color={PALETTE[row.tone]}>{outcome}</Text>
            {idle && <Text color={PALETTE[row.idle!.tone]}>{` ${idle}`}</Text>}
          </Box>
        })}
      </Box>}
      {sections && working.map((item, index) => <Box key={`pi-all-${item.id}`} flexDirection="column">
        <Text>{`\n── ${taskLabel(item)}${allProgress[item.id]?.lastActivity ? ` · ${allProgress[item.id]!.lastActivity}` : ''}`}</Text>
        {sections[index]!.lines.map(line => <Text key={`${item.id}-${line.key}`} dimColor={line.dim}>{line.text}</Text>)}
      </Box>)}
      {!sections && task && <Text>{`\n${taskLabel(task)}${pi?.lastActivity ? ` · ${pi.lastActivity}` : ''}\n${pi ? `${pi.tokens} tokens · $${pi.cost.toFixed(3)}` : 'usage n/a'}`}</Text>}
      {!sections && transcriptLines(transcript, state.showThinking ?? false).map(line => <Text key={line.key} dimColor={line.dim}>{line.text}</Text>)}
      {task && <Box flexDirection="row" flexWrap="wrap" columnGap={1} marginTop={1}>
        {!complete(task) && <Button key="pi-abort" hotkey="x" onPress={() => void askConfirm($, 'kill', [task.id])}>Abort</Button>}
        {task.task && eligible('kill', task.task.state) && <Button key="pi-hold" hotkey="h" onPress={() => void askConfirm($, 'hold', [task.id])}>Hold queue</Button>}
        {task.task && eligible('pause', task.task.state) && <Button key="pi-stop" hotkey="s" onPress={() => void stopQueue($, task.task?.group ?? 'default')}>Stop queue</Button>}
        {!complete(task) && <Button key="pi-pause" hotkey="p" onPress={() => void runControl($, task.task?.state === 'Paused' ? 'resume' : 'pause', [task.id], task.task?.group ?? 'default')}>{task.task?.state === 'Paused' ? 'Resume' : 'Pause'}</Button>}
        {complete(task) && <Button key="pi-remove" onPress={() => void runControl($, 'rm', [task.id], task.task?.group ?? 'default')}>Remove</Button>}
        <Button key="pi-dismiss" onPress={() => void dismiss($, task)}>Dismiss</Button>
        {pending && <Button key="pi-open-review" onPress={() => void openReview($, task)}>Open review</Button>}
        {pending && <Button key="pi-approve" onPress={() => void approve($, task, pending)}>Approve</Button>}
        {pending && <Button key="pi-reject-all" onPress={() => { const confirmed = !needsRejectConfirm(rejecting, pending.runId); rejecting = confirmed ? undefined : pending.runId; void rejectAll($, task, pending.runId, confirmed) }}>Reject all</Button>}
      </Box>}
      {task && <Input key="pi-continue" label="Continue" placeholder="Follow-up for Pi" submitLabel="send" onSubmit={value => void continueTask($, task, pi, value)} />}
      {task?.task?.state === 'Queued' && <Input key="pi-edit" label="Edit" placeholder="model[:effort] [label]" submitLabel="re-add" onSubmit={value => void editTask($, task, value).catch(error => $.ui.toast(`Edit failed: ${String(error)}`))} />}
      <Box flexDirection="row" columnGap={1} marginTop={1}>
        <Button key="pi-history" onPress={() => void goTo($, 'pi-history')}>history</Button>
        <Button key="pi-clean-stale" onPress={() => void cleanStale($)}>Clean stale</Button>
      </Box>
    </Box>
  })

  // The person's arrows move the focus ring over the row Buttons; the task under the ring is the selected one.
  // A plugin's move (j/k already selected; an autoFocus) is not a pick, so it never pins the transcript.
  on('ui.focus', { requestId: 'pi-handoff' }, async ($, e, next) => {
    const id = /^pi-row-(\d+)$/.exec(e.element ?? '')?.[1]
    if (id !== undefined && e.origin?.kind === 'person') await update($, handoff, value => ({ ...value, selectedId: Number(id) }))
    return next(e)
  })
}
