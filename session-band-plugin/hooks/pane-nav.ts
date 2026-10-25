// The panes this mod draws. Switching cycles only among these, never another plugin's pane.
// The engine does not let `$` cross an import, so each pane calls $.ui.panes() and $.ui.open() itself and
// uses these pure pickers for the target and the moves.
export const MOD_PANES = ['pi-handoff', 'pi-history', 'worktrees', 'draft-prs', 'gates'] as const

export const FOCUS_ACTION = 'app:cycleDiffBase'
export const FOCUS_REFUSED = 'Clear the prompt first: ctrl+x b focuses the pane only from an empty prompt.'

// The open mod pane after (or before, step -1) `current`, wrapping. Undefined when none is open.
export const nextPane = (open: readonly string[], current: string, step: 1 | -1): string | undefined => {
  const mine = MOD_PANES.filter(id => open.includes(id))
  if (mine.length === 0) return undefined
  const at = mine.indexOf(current as (typeof MOD_PANES)[number])
  if (at < 0) return mine[0]
  return mine[(at + step + mine.length) % mine.length]
}

export type ModPane = (typeof MOD_PANES)[number]
export const PANE_TITLES: Record<ModPane | 'review', string> = { 'pi-handoff': 'Pi hand-off', 'pi-history': 'Pi history', worktrees: 'Worktrees', 'draft-prs': 'Draft PRs', gates: 'Gates', review: 'Review' }

// The jump digits, the same in every pane. A pane's own digit does nothing; each jump uses that
// pane's existing goTo runner, which also opens a pane that is not yet open.
export const JUMP_KEYS: readonly { key: '1' | '2' | '3' | '4' | '5'; id: ModPane; label: string }[] = [
  { key: '1', id: 'pi-handoff', label: 'pi' },
  { key: '2', id: 'pi-history', label: 'history' },
  { key: '3', id: 'worktrees', label: 'worktrees' },
  { key: '4', id: 'draft-prs', label: 'drafts' },
  { key: '5', id: 'gates', label: 'gates' },
]
const titleOf = (id: string) => PANE_TITLES[id as ModPane] ?? id

export type PaneStep = { close: string } | { open: string; title: string; focus?: true }

// Moving from the focused pane `current` to `to`. A pane holding the keys refuses `focus` on another
// pane's open, and opening an open id only retitles it, so nothing would show. Closing `current` first
// hands the keys back to the prompt; the target then opens focused, and `current` reopens behind it as a tab.
export const switchSteps = (current: string, to: string | undefined): PaneStep[] =>
  !to || to === current ? [] : [{ close: current }, { open: to, title: titleOf(to), focus: true }, { open: current, title: titleOf(current) }]
