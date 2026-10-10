import type { PiProgress } from './pisession'
import type { PueueState, Task } from './pueue'
import type { ReviewState } from './review'

export type TrackedTask = {
  id: number
  sessionId?: string
  label?: string
  cwd: string
  addedMs: number
  task?: Task
  finishedMs?: number
  dismissed?: boolean
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

export const formatElapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return minutes < 60 ? `${minutes}m${seconds % 60}s` : `${Math.floor(minutes / 60)}h${minutes % 60}m`
}

export const formatTokens = (tokens: number): string => tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}m` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

const visible = (item: TrackedTask, review: ReviewState, nowMs: number) => {
  const state = item.task?.state
  if (live(state) || state === 'Failed' || state === 'Killed') return true
  if (state !== 'Done') return false
  if (review === 'pending') return true
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
  const state = task?.state ?? 'Other'
  const model = pi?.model ?? (task ? undefined : undefined)
  const started = task?.startMs ?? task?.enqueuedMs ?? item.addedMs
  const elapsed = formatElapsed((finished(state) ? task?.endMs ?? nowMs : nowMs) - started)
  const modelEffort = [model, pi?.effort].filter(Boolean).join(':') || undefined
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
    ...(model ? { model } : {}), ...(pi?.effort ? { effort: pi.effort } : {}), elapsed,
    ...(pi ? { tokens: formatTokens(pi.tokens), cost: cost(pi.cost), files: pi.files.length } : {}),
    ...(item.label ? { label: item.label } : {}), ...(review[item.id] ? { review: review[item.id] } : {}), ...(task?.exit !== undefined ? { exit: task.exit } : {}),
  }
}

export type StaleSession = { path: string; name: string; mtimeMs: number; size: number }
export type StaleSelection = { tasks: TrackedTask[]; sessions: StaleSession[]; bytes: number }

export const selectStale = (tracked: readonly TrackedTask[], sessions: readonly StaleSession[], nowMs: number): StaleSelection => {
  const older = nowMs - 7 * 24 * 60 * 60 * 1000
  const tasks = tracked.filter(item => finished(item.task?.state) && (item.task?.endMs ?? item.finishedMs ?? item.addedMs) < older)
  const labels = new Set(tasks.map(item => item.sessionId).filter((id): id is string => id.startsWith('pueue-')))
  const selected = sessions.filter(session => session.mtimeMs < older && [...labels].some(id => session.name.endsWith(`_${id}.jsonl`)))
  return { tasks, sessions: selected, bytes: selected.reduce((total, session) => total + session.size, 0) }
}
