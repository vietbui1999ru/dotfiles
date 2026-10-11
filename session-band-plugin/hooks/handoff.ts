import type { PiProgress } from './pisession'
import { parsePiCommand, type PueueState, type Task } from './pueue'
import type { ReviewState } from './review'

export type TrackedTask = {
  id: number
  sessionId?: string
  runId?: string
  label?: string
  cwd: string
  addedMs: number
  task?: Task
  finishedMs?: number
  dismissed?: boolean
}

export type MonitorRow = {
  id: number
  state: PueueState
  glyph: string
  modelEffort?: string
  elapsed: string
  activity: string
  tokens: string
  cost: string
  idle?: { text: string; tone: 'muted' | 'yellow' | 'red' }
  label?: string
}

export type HandoffSegment = {
  kind: 'single' | 'rollup'
  text: string
  id?: number
  state?: PueueState
  glyph?: string
  model?: string
  effort?: string
  elapsed?: string
  tokens?: string
  cost?: string
  files?: number
  label?: string
  review?: ReviewState
  exit?: number
  running?: number
  done?: number
}

const finished = (state: PueueState | undefined) => state === 'Done' || state === 'Failed' || state === 'Killed'
const live = (state: PueueState | undefined) => state === 'Queued' || state === 'Running' || state === 'Paused'
const glyph = (state: PueueState | undefined) => state === 'Running' ? '▶' : state === 'Queued' ? '…' : state === 'Paused' ? 'Ⅱ' : state === 'Done' ? '✓' : state === 'Failed' || state === 'Killed' ? '!' : '?'
const cost = (value: number) => `$${value < 0.01 ? value.toFixed(3) : value.toFixed(2)}`
const monitorGlyph = (state: PueueState) => state === 'Running' ? '▶' : state === 'Queued' ? '◌' : state === 'Paused' ? '⏸' : state === 'Done' ? '✓' : state === 'Failed' || state === 'Killed' ? '✗' : '?'
const monitorVisible = (item: TrackedTask, nowMs: number) => {
  const state = item.task?.state
  return !item.dismissed && (live(state) || state === 'Failed' || state === 'Killed' || (state === 'Done' && nowMs - (item.finishedMs ?? item.task?.endMs ?? item.addedMs) <= 30_000))
}
const monitorOrder = (state: PueueState) => state === 'Failed' || state === 'Killed' ? 0 : state === 'Running' ? 1 : state === 'Queued' || state === 'Paused' ? 2 : state === 'Done' ? 3 : 4

export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m${seconds % 60}s` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export const formatTokens = (tokens: number): string => tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}m` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

export const activityLabel = (progress: PiProgress | undefined): string =>
  progress?.lastActivity ?? (progress?.lastEventAssistant ? 'thinking' : 'starting')

export const idleAge = (progress: PiProgress | undefined, task: Task | undefined, nowMs: number): MonitorRow['idle'] => {
  if (!progress?.lastEventMs || finished(task?.state)) return undefined
  const age = nowMs - progress.lastEventMs
  if (age <= 30_000) return undefined
  return { text: `idle ${formatElapsed(age)}`, tone: age > 300_000 ? 'red' : age > 120_000 ? 'yellow' : 'muted' }
}

export const monitorRows = (
  tracked: readonly TrackedTask[],
  progress: Readonly<Record<number, PiProgress | undefined>>,
  tasks: readonly Task[],
  nowMs: number,
): MonitorRow[] => {
  const current = new Map(tasks.map(task => [task.id, task]))
  return tracked
    .map(item => ({ item, task: current.get(item.id) ?? item.task }))
    .filter(({ item, task }) => monitorVisible({ ...item, task }, nowMs))
    .sort((left, right) => {
      const stateOrder = monitorOrder(left.task?.state ?? 'Other') - monitorOrder(right.task?.state ?? 'Other')
      if (stateOrder !== 0) return stateOrder
      if (left.task?.state === 'Done' && right.task?.state === 'Done') return (right.task.endMs ?? right.item.finishedMs ?? right.item.addedMs) - (left.task.endMs ?? left.item.finishedMs ?? left.item.addedMs)
      return 0
    })
    .map(({ item, task }) => {
      const state = task?.state ?? 'Other'
      const pi = progress[item.id]
      const parsed = task ? parsePiCommand(task.command) : undefined
      const started = task?.startMs ?? task?.enqueuedMs ?? item.addedMs
      const ended = finished(state) ? task?.endMs ?? nowMs : nowMs
      const modelEffort = item.sessionId ? [pi?.model ?? parsed?.model, pi?.effort ?? parsed?.effort].filter(Boolean).join(':') || undefined : undefined
      return {
        id: item.id,
        state,
        glyph: monitorGlyph(state),
        ...(modelEffort ? { modelEffort } : {}),
        elapsed: formatElapsed(ended - started),
        activity: item.sessionId ? activityLabel(pi) : 'n/a',
        tokens: pi ? `${formatTokens(pi.tokens)} tok` : 'n/a',
        cost: pi ? cost(pi.cost) : 'n/a',
        ...(idleAge(pi, task, nowMs) ? { idle: idleAge(pi, task, nowMs) } : {}),
        ...(item.label ? { label: item.label } : {}),
      }
    })
}

const isReviewResult = (item: TrackedTask, review: ReviewState) =>
  item.task?.state === 'Failed' && item.task.exit === 1 && review !== undefined

const visible = (item: TrackedTask, review: ReviewState, nowMs: number) => {
  const state = item.task?.state
  if (live(state) || state === 'Killed' || (state === 'Failed' && !isReviewResult(item, review))) return true
  if (state !== 'Done' && !isReviewResult(item, review)) return false
  if (review === 'pending' || review === 'decided, waiting for the next Pi run in this repo') return true
  return nowMs - (item.finishedMs ?? item.task?.endMs ?? item.addedMs) <= 30_000
}

export const summarize = (
  tracked: readonly TrackedTask[],
  progress: Readonly<Record<number, PiProgress | undefined>>,
  review: Readonly<Record<number, ReviewState | undefined>>,
  nowMs: number,
): HandoffSegment | null => {
  const items = tracked.filter(item => !item.dismissed && visible(item, review[item.id], nowMs))
  if (items.length === 0) return null
  if (items.length > 1) {
    const active = items.filter(item => live(item.task?.state)).length
    const done = items.filter(item => item.task?.state === 'Done').length
    return { kind: 'rollup', text: `pi ${active}▶${done ? ` ${done}✓` : ''}`, running: active, done }
  }
  const item = items[0]!
  const task = item.task
  const pi = progress[item.id]
  const taskState = task?.state ?? 'Other'
  const state = isReviewResult(item, review[item.id]) ? 'Done' : taskState
  const parsed = task ? parsePiCommand(task.command) : undefined
  const model = pi?.model ?? parsed?.model
  const started = task?.startMs ?? task?.enqueuedMs ?? item.addedMs
  const elapsed = formatElapsed((finished(taskState) ? task?.endMs ?? nowMs : nowMs) - started)
  const modelEffort = [model, pi?.effort ?? parsed?.effort].filter(Boolean).join(':') || undefined
  const fields = [
    `pi#${item.id}${glyph(state)}`,
    modelEffort,
    elapsed,
    pi ? `${formatTokens(pi.tokens)} tok` : item.sessionId ? 'n/a' : 'n/a',
    pi && pi.cost > 0 ? cost(pi.cost) : undefined,
    pi?.files.length ? `${pi.files.length} files` : undefined,
    item.label,
    review[item.id],
    state === 'Failed' && task?.exit !== undefined ? `exit ${task.exit}` : undefined,
    state === 'Killed' ? 'killed' : undefined,
  ].filter(Boolean)
  return {
    kind: 'single', text: fields.join(' '), id: item.id, state, glyph: glyph(state),
    ...(model ? { model } : {}), ...(pi?.effort ?? parsed?.effort ? { effort: pi?.effort ?? parsed?.effort } : {}), elapsed,
    ...(pi ? { tokens: formatTokens(pi.tokens), cost: cost(pi.cost), files: pi.files.length } : {}),
    ...(item.label ? { label: item.label } : {}), ...(review[item.id] ? { review: review[item.id] } : {}), ...(task?.exit !== undefined ? { exit: task.exit } : {}),
  }
}

export type StaleSession = { path: string; name: string; mtimeMs: number; size: number }
export type StaleSelection = { tasks: TrackedTask[]; sessions: StaleSession[]; bytes: number }

export const selectStale = (tracked: readonly TrackedTask[], sessions: readonly StaleSession[], nowMs: number): StaleSelection => {
  const older = nowMs - 7 * 24 * 60 * 60 * 1000
  const tasks = tracked.filter(item => finished(item.task?.state) && (item.task?.endMs ?? item.finishedMs ?? item.addedMs) < older)
  const labels = new Set(tasks.flatMap(item => item.sessionId?.startsWith('pueue-') ? [item.sessionId] : []))
  const selected = sessions.filter(session => session.mtimeMs < older && [...labels].some(id => session.name.endsWith(`_${id}.jsonl`)))
  return { tasks, sessions: selected, bytes: selected.reduce((total, session) => total + session.size, 0) }
}
