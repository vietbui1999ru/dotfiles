// Pure logic for the focus slots: the chip the band shows, from `scripts/focus status --json`.
// No engine here, so focus.test.ts runs without the Claude Code host; focus.tsx does the engine work.
import type { Seg } from './band-text'
import type { Tone } from './palette'

/** One slot's item as `scripts/focus status --json` prints it: its key and stage. */
export type FocusItem = { key: string; stage: string }

/** The board as the focus script reports it. `read_only` is set only when a cwd was passed to status. */
export type FocusState = {
  work: FocusItem | null
  hobby: FocusItem | null
  frozen: FocusItem[]
  parked: string[]
  read_only?: boolean
  breaches?: string[]
  no_board?: boolean
}

/** The argv that reads the board for one cwd. The script path is the stowed one, never a relative path. */
export const FOCUS_ARGV = (home: string, cwd: string): string[] => [`${home}/dotfiles/scripts/focus`, 'status', '--json', '--cwd', cwd]

/** A parsed status, or undefined when the output is not a board (no board, a failed run, or junk). */
export const parseFocus = (stdout: string | undefined): FocusState | undefined => {
  if (!stdout) return undefined
  let data: unknown
  try { data = JSON.parse(stdout) } catch { return undefined }
  if (!data || typeof data !== 'object') return undefined
  const state = data as Partial<FocusState> & { no_board?: boolean }
  if (state.no_board) return undefined
  return { work: state.work ?? null, hobby: state.hobby ?? null, frozen: state.frozen ?? [], parked: state.parked ?? [], read_only: state.read_only, breaches: state.breaches ?? [] }
}

const item = (label: string, slot: FocusItem | null): string => (slot ? `${label} ${slot.key}·${slot.stage}` : `${label} —`)

/** The slots, always shown: an empty one as —. */
export const focusSlots = (state: FocusState): string => [item('H', state.hobby), item('W', state.work)].join(' ')

/** The full chip text, slots first; the frozen count and read-only follow when they apply. */
export const focusText = (state: FocusState): string => {
  const parts = [focusSlots(state)]
  if (state.frozen.length > 0) parts.push(`❄${state.frozen.length}`)
  if (state.read_only) parts.push('read-only')
  return parts.join(' ')
}

// A breach is red, a read-only session is yellow, otherwise the focus colour.
const focusTone = (state: FocusState): Tone => {
  if (state.breaches && state.breaches.length > 0) return 'red'
  if (state.read_only) return 'yellow'
  return 'teal'
}

/** The focus segments for the band. The slots never drop; the frozen count (drop rank 2) goes first in a narrow band, before the git chips. */
export const focusChip = (state: FocusState | undefined): Seg[] => {
  if (!state) return []
  const tone = focusTone(state)
  const runs: Seg[] = [{ text: focusSlots(state), tone }]
  if (state.frozen.length > 0) runs.push({ text: `❄${state.frozen.length}`, tone: 'muted', drop: 2 })
  if (state.read_only) runs.push({ text: 'read-only', tone: 'yellow' })
  return runs
}
