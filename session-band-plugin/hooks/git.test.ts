import { expect, test } from 'claude-code/testing'

import { toSnapshot } from './git'
import { toRepoInfo } from './repo'

test('toSnapshot reads ahead/behind, stash and a linked worktree name', () => {
  const snap = toSnapshot({
    branch: 'feat',
    isDirty: true,
    upstream: 'origin/feat',
    counts: '2\t3',
    stash: 'a\nb',
    gitDir: '/r/.git/worktrees/worktree-band',
    common: '/r/.git',
  })

  expect(snap).toEqual({ branch: 'feat', isDirty: true, ahead: 3, behind: 2, hasUpstream: true, stash: 2, worktree: 'band' })
})

test('toSnapshot is null off a branch and has no worktree in the main checkout', () => {
  expect(toSnapshot({ isDirty: false })).toBeNull()
  expect(toSnapshot({ branch: 'main', isDirty: false, gitDir: '/r/.git', common: '/r/.git' })?.worktree).toBeUndefined()
})

test('toRepoInfo points an agent task at its claimed state file', () => {
  expect(toRepoInfo('/r/.git', 'T-1').statePath).toBe('/r/.agents/claimed/T-1.state.md')
  expect(toRepoInfo('/r/.git', undefined).statePath).toBe('/r/.claude/session-state.md')
})
