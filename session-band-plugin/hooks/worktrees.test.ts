import { expect, test } from 'claude-code/testing'

import { countChanges, parseAheadBehind, parseHeartbeat, parseWorktrees } from './worktrees'

const porcelain = [
  'worktree /repo',
  'HEAD 1234567890abcdef',
  'branch refs/heads/main',
  '',
  'worktree /repo/.claude/worktrees/lightrag-opencode',
  'HEAD abcdef1234567890',
  'branch refs/heads/docs/laya',
  '',
  'worktree /repo/.claude/worktrees/old',
  'HEAD 0000000000000000',
  'detached',
  'prunable gitdir file points to non-existent location',
  '',
].join('\n')

test('parses each worktree block, with branch, detached and prunable state', () => {
  const trees = parseWorktrees(porcelain)
  expect(trees.map(tree => tree.path)).toEqual(['/repo', '/repo/.claude/worktrees/lightrag-opencode', '/repo/.claude/worktrees/old'])
  expect(trees[0]).toEqual({ path: '/repo', head: '1234567', branch: 'main', detached: false, prunable: false })
  expect(trees[1].branch).toBe('docs/laya')
  expect(trees[2]).toEqual({ path: '/repo/.claude/worktrees/old', head: '0000000', branch: undefined, detached: true, prunable: true })
})

test('ahead and behind come from rev-list left-right counts (behind first)', () => {
  expect(parseAheadBehind('2\t5\n')).toEqual({ ahead: 5, behind: 2 })
  expect(parseAheadBehind('0\t0')).toEqual({ ahead: 0, behind: 0 })
})

test('any changed path makes a worktree dirty', () => {
  expect(countChanges('')).toBe(0)
  expect(countChanges(' M a.ts\n?? b.ts\n')).toBe(2)
})

test('heartbeat carries the session cwd after the timestamp, and tolerates tabs in the path', () => {
  expect(parseHeartbeat('1791400000\t/repo/wt\n')).toEqual({ atSec: 1791400000, cwd: '/repo/wt' })
  expect(parseHeartbeat('1791400000\t/a\tb')).toEqual({ atSec: 1791400000, cwd: '/a\tb' })
  expect(parseHeartbeat('1791400000\n')).toBeUndefined()
})
