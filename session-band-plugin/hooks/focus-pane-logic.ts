// Pure logic for the /focus pane (AC-10): the pipeline text, the row lists and the argv each hotkey
// runs. No engine here, so focus-pane.test.ts runs without the Claude Code host; focus-pane.tsx draws it.
import type { FocusItem, FocusState } from './focus'

/** Pipeline order, the same as scripts/focus STAGES. An unknown stage ('?') lights no step. */
export const STAGES = ['spec', 'plan', 'build', 'review', 'merge'] as const

/** One selectable row: a frozen item, or a parked line. Parked lines are free text, so they have no stage. */
export type FocusRow = { kind: 'frozen'; key: string; stage: string } | { kind: 'parked'; text: string }

/** The pipeline for one item: each stage, the current one in brackets. `?` lights no stage. */
export const pipeline = (stage: string): string =>
  STAGES.map(name => (name === stage ? `[${name}]` : name)).join(' › ')

/** A slot line: the key and its pipeline, or an em dash when the slot is empty. */
export const slotLine = (label: string, slot: FocusItem | null): string =>
  slot ? `${label}  ${slot.key}  ${pipeline(slot.stage)}` : `${label}  —`

/** Frozen then parked, in the order the board keeps them; the selection moves through these. */
export const rows = (state: FocusState): FocusRow[] => [
  ...state.frozen.map((item): FocusRow => ({ kind: 'frozen', key: item.key, stage: item.stage })),
  ...state.parked.map((text): FocusRow => ({ kind: 'parked', text })),
]

/** The row a hotkey acts on: the selected one, else the first. Undefined when there are no rows. */
export const pick = (all: FocusRow[], selected: string | undefined): FocusRow | undefined =>
  all.find(row => rowId(row) === selected) ?? all[0]

/** A stable id for a row, used as the selection value. */
export const rowId = (row: FocusRow): string => (row.kind === 'frozen' ? `f:${row.key}` : `p:${row.text}`)

/** j/k step through the rows, wrapping at both ends. Returns the new selection id. */
export const step = (all: FocusRow[], selected: string | undefined, by: 1 | -1): string | undefined => {
  if (all.length === 0) return undefined
  const at = Math.max(all.findIndex(row => rowId(row) === selected), 0)
  return rowId(all[(at + by + all.length) % all.length] as FocusRow)
}

/** The key a row acts on, for switch/drop/park. A parked row's text is its key when it is one (repo:branch). */
export const keyOf = (row: FocusRow | undefined): string | undefined => {
  if (!row) return undefined
  if (row.kind === 'frozen') return row.key
  return KEY_ONLY.test(row.text) ? row.text : undefined
}
const KEY_ONLY = /^[A-Za-z0-9._-]+:[^\s|]+$/

/** The argv for each hotkey. `drop` never carries --yes: the pane removes from the board only. */
export const ACTIONS = {
  open: (board: string): string[] => ['open', `obsidian://open?path=${encodeURIComponent(board)}`],
  switch: (home: string, key: string): string[] => [`${home}/dotfiles/scripts/focus`, 'switch', key],
  drop: (home: string, key: string): string[] => [`${home}/dotfiles/scripts/focus`, 'drop', key],
  park: (home: string, key: string): string[] => [`${home}/dotfiles/scripts/focus`, 'park', key],
  status: (home: string, cwd: string): string[] => [`${home}/dotfiles/scripts/focus`, 'status', '--json', '--cwd', cwd],
} as const
