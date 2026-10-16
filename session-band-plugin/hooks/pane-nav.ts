// The panes this mod draws. Switching cycles only among these, never another plugin's pane.
// The engine does not let `$` cross an import, so each pane calls $.ui.panes() and $.ui.open() itself and
// uses this pure picker for the target.
export const MOD_PANES = ['pi-handoff', 'pi-history', 'worktrees'] as const

// The open mod pane after (or before, step -1) `current`, wrapping. Undefined when none is open.
export const nextPane = (open: readonly string[], current: string, step: 1 | -1): string | undefined => {
  const mine = MOD_PANES.filter(id => open.includes(id))
  if (mine.length === 0) return undefined
  const at = mine.indexOf(current as (typeof MOD_PANES)[number])
  if (at < 0) return mine[0]
  return mine[(at + step + mine.length) % mine.length]
}
