// Parsers for the git output the worktrees pane reads. The process calls stay in register code (the engine
// does not let `$` cross an import); this file only turns their text into rows.
export const SYMBOL = { branch: '⎇', ahead: '↑', behind: '↓', dirty: '✎', live: '●', detached: '⊘', prunable: '⚠' } as const

export type Worktree = { path: string; head: string; branch?: string; detached: boolean; prunable: boolean }

// `git worktree list --porcelain`: blocks separated by a blank line, one attribute per line.
export const parseWorktrees = (porcelain: string): Worktree[] =>
  porcelain.split('\n\n').filter(Boolean).flatMap(block => {
    const lines = block.split('\n')
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) return []
    const branchRef = lines.find(line => line.startsWith('branch '))?.slice('branch '.length)
    return [{
      path,
      head: (lines.find(line => line.startsWith('HEAD '))?.slice(5) ?? '').slice(0, 7),
      branch: branchRef?.replace(/^refs\/heads\//, ''),
      detached: lines.includes('detached'),
      prunable: lines.some(line => line.startsWith('prunable')),
    }]
  })

// `git rev-list --left-right --count @{u}...HEAD` prints "<behind>\t<ahead>".
export const parseAheadBehind = (text: string): { ahead: number; behind: number } => {
  const [behind = 0, ahead = 0] = text.trim().split(/\s+/).map(Number)
  return { ahead, behind }
}

// `git status --porcelain`: one line per changed path; any line means dirty.
export const countChanges = (porcelain: string): number => porcelain.split('\n').filter(Boolean).length

// Heartbeat body written by the mod: "<unix seconds>\t<session cwd>".
export const parseHeartbeat = (body: string): { atSec: number; cwd: string } | undefined => {
  const [sec, ...rest] = body.trim().split('\t')
  const atSec = Number(sec)
  return Number.isFinite(atSec) && rest.length > 0 ? { atSec, cwd: rest.join('\t') } : undefined
}
