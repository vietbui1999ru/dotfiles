import { formatElapsed, formatTokens } from './handoff'
import { parsePiCommand, isPiDispatch, type Task } from './pueue'
import type { Tone } from './palette'
import type { ReviewState } from './review'

export type HistoryFilter = 'all' | 'done' | 'failed' | 'killed'
export type HistoryUsage = { tokens?: number; cost?: number; loading?: boolean; available?: boolean; finalMessage?: string }

export type ResultStyle = { glyph: string; result: string; tone: Tone }
export type HistoryRow = {
  task: Task
  style: ResultStyle
  label: string
  modelEffort?: string
  duration: string
  finished: string
  repo: string
  usage: string
  review?: 'approved' | 'changes requested' | 'pending'
}

export const HISTORY_DAYS = 7
export const HISTORY_PAGE_SIZE = 50
const WINDOW_MS = HISTORY_DAYS * 24 * 60 * 60 * 1000

const completed = (task: Task) => task.state === 'Done' || task.state === 'Failed' || task.state === 'Killed'
const filtered = (task: Task, filter: HistoryFilter) =>
  filter === 'all' || (filter === 'done' && task.state === 'Done') || (filter === 'failed' && task.state === 'Failed') || (filter === 'killed' && task.state === 'Killed')

/** agent-review ends a print run that left a review with 3; runs from before that used 1. */
export const leftReviewExit = (exit: number | undefined): boolean => exit === 3 || exit === 1

export const resultStyle =(task: Task, hadPendingReview: boolean): ResultStyle => {
  if (task.state === 'Done') return { glyph: '✓', result: 'success', tone: 'green' }
  if (task.state === 'Killed') return { glyph: '✗', result: 'killed', tone: 'mauve' }
  if (task.state === 'Failed' && leftReviewExit(task.exit) && hadPendingReview) return { glyph: '✓', result: 'review', tone: 'yellow' }
  return { glyph: '✗', result: `exit ${task.exit ?? '?'}`, tone: 'red' }
}

export const relativeTime = (ms: number, nowMs: number): string => {
  const elapsed = Math.max(0, nowMs - ms)
  const seconds = Math.floor(elapsed / 1000)
  if (seconds < 60) return seconds <= 1 ? 'now' : `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  if (hours < 48) return 'yesterday'
  return `${Math.floor(hours / 24)}d ago`
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined

/** The last complete assistant text block in a JSONL tail, limited to twenty lines. */
export const finalMessage = (jsonlTail: string): string | undefined => {
  for (const line of jsonlTail.split('\n').reverse()) {
    try {
      const event = object(JSON.parse(line))
      const message = event?.type === 'message' ? object(event.message) : undefined
      if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
      for (const block of [...message.content].reverse()) {
        const text = object(block)?.type === 'text' && typeof object(block)?.text === 'string' ? object(block)?.text : undefined
        if (text?.trim()) return text.split('\n').slice(-20).join('\n')
      }
    } catch { /* tails can start or end inside a JSONL record */ }
  }
  return undefined
}

/** Pi's agent-review line in a task's output: this run ended Failed(1) to leave a review. */
export const leftReview = (output: string): boolean => /agent-review: run .* awaiting review/.test(output)

const repoName = (cwd: string) => cwd.split('/').filter(Boolean).pop() ?? cwd
const labelFor = (task: Task) => task.label?.trim() || task.command.replace(/\s+/g, ' ').slice(0, 48)
const reviewLabel = (review: ReviewState | undefined): HistoryRow['review'] =>
  review === 'approved' || review === 'changes requested' ? review : review ? 'pending' : undefined
const usageLabel = (task: Task, usage: HistoryUsage | undefined): string => {
  if (!parsePiCommand(task.command).sessionId) return 'n/a'
  if (!usage || usage.loading) return '…'
  if (usage.available === false || usage.tokens === undefined || usage.cost === undefined) return 'n/a'
  return `${formatTokens(usage.tokens)} tok $${usage.cost.toFixed(usage.cost < 0.01 ? 3 : 2)}`
}

const rows = (
  tasks: readonly Task[],
  reviews: Readonly<Record<number, ReviewState | undefined>>,
  usage: Readonly<Record<number, HistoryUsage | undefined>>,
  nowMs: number,
  filter: HistoryFilter,
  leftReviews: ReadonlySet<number>,
): HistoryRow[] => tasks
  .filter(task => completed(task) && isPiDispatch(task.command) && task.endMs !== undefined && task.endMs >= nowMs - WINDOW_MS && filtered(task, filter))
  .sort((left, right) => (right.endMs ?? 0) - (left.endMs ?? 0))
  .map(task => {
    const review = reviews[task.id]
    const parsed = parsePiCommand(task.command)
    const start = task.startMs ?? task.enqueuedMs ?? task.endMs ?? nowMs
    const end = task.endMs ?? nowMs
    return {
      task,
      // Any review state, or the run's own log, means it left a review. Once the review is
      // resolved its pending record is gone, so 'pending' alone would turn every reviewed run red.
      style: resultStyle(task, review !== undefined || leftReviews.has(task.id)),
      label: labelFor(task),
      ...([parsed.model, parsed.effort].filter(Boolean).join(':') ? { modelEffort: [parsed.model, parsed.effort].filter(Boolean).join(':') } : {}),
      duration: formatElapsed(end - start),
      finished: relativeTime(end, nowMs),
      repo: repoName(task.cwd),
      usage: usageLabel(task, usage[task.id]),
      ...(reviewLabel(review) ? { review: reviewLabel(review) } : {}),
    }
  })

/** The first page of finished Pi dispatches, newest first. */
export const historyRows = (
  tasks: readonly Task[],
  reviews: Readonly<Record<number, ReviewState | undefined>>,
  usage: Readonly<Record<number, HistoryUsage | undefined>>,
  nowMs: number,
  filter: HistoryFilter,
  leftReviews: ReadonlySet<number> = new Set(),
): HistoryRow[] => rows(tasks, reviews, usage, nowMs, filter, leftReviews).slice(0, HISTORY_PAGE_SIZE)

/** Additional pages are only used by the read-only pane's Show older button. */
export const historyRowsPage = (
  tasks: readonly Task[],
  reviews: Readonly<Record<number, ReviewState | undefined>>,
  usage: Readonly<Record<number, HistoryUsage | undefined>>,
  nowMs: number,
  filter: HistoryFilter,
  limit: number,
  leftReviews: ReadonlySet<number> = new Set(),
): HistoryRow[] => rows(tasks, reviews, usage, nowMs, filter, leftReviews).slice(0, limit)

export const truncateCommand = (command: string, limit = 120): string =>
  command.length <= limit ? command : `${command.slice(0, Math.max(0, limit - 1))}…`
