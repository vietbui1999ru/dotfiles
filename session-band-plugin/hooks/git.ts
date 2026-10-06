import type { GitSnapshot } from '../types'

// Raw outputs of the git calls register.tsx makes. The engine does not let `$` cross an
// import, so the process calls stay in register.tsx and only this parsing lives here.
export type GitFacts = {
  branch?: string
  isDirty: boolean
  upstream?: string
  counts?: string
  stash?: string
  gitDir?: string
  common?: string
}

// Same facts as the retired shell line: branch, dirty, ahead/behind, stash, worktree.
export const toSnapshot = (f: GitFacts): GitSnapshot | null => {
  if (!f.branch) return null

  const [behind = 0, ahead = 0] = (f.counts || '').split(/\s+/).map(Number)
  const isLinked = !!f.gitDir && !!f.common && f.gitDir !== f.common
  // A linked worktree's git dir is <main>/.git/worktrees/<name>; the shell script took
  // the parent of that and so always printed "worktrees".
  const worktree = isLinked ? f.gitDir?.split('/').pop()?.replace(/^worktree-/, '') : undefined

  return {
    branch: f.branch,
    isDirty: f.isDirty,
    ahead,
    behind,
    hasUpstream: !!f.upstream,
    stash: f.stash ? f.stash.split('\n').length : 0,
    worktree,
  }
}
