import { expect, test } from 'claude-code/testing'

import type { WorktreeBranch, WorktreeRow } from '../types'
import { detailLines, legendLines, liveByTree, paneLines, treeItems, treeKeys, treeLines } from './worktrees'

const main: WorktreeRow = { path: '/repo', head: '1234567', branch: 'main', detached: false, prunable: false, changes: 0, ahead: 0, behind: 0, live: 1 }
const laya: WorktreeRow = { path: '/repo/.claude/worktrees/lightrag-opencode', head: 'abcdef1', branch: 'docs/laya', detached: false, prunable: false, changes: 2, ahead: 0, behind: 0, live: 0 }
const old: WorktreeRow = { path: '/repo/.claude/worktrees/old', head: '0000000', detached: true, prunable: false, changes: 0, ahead: 0, behind: 0, live: 0 }

const rows = [main, laya, old]
const branches: WorktreeBranch[] = [
  { name: 'main', worktree: '/repo' },
  { name: 'docs/laya', worktree: laya.path },
  { name: 'feat/x', ahead: 2, behind: 0 },
]

test('items needing action sort first, quiet ones after; detached worktrees come last', () => {
  expect(treeKeys(rows, branches)).toEqual(['/repo', 'docs/laya', 'feat/x', 'detached:/repo/.claude/worktrees/old'])
  expect(treeItems(rows, branches).map(item => item.action)).toEqual([true, true, false])
})

test('the tree: root, a stem, one branch group per line, worktrees nested under their branch, flags in one column', () => {
  expect(treeLines(rows, branches, undefined).map(line => line.text)).toEqual([
    ' repo  main    ●1',
    ' │',
    ' ├─ docs/laya  ✎2',
    ' │  └─ lightrag-opencode',
    ' ├─ feat/x     ↑2',
    ' └─ ⊘ 0000000',
    '    └─ old',
  ])
})

test('the selected line is marked with a chevron in column 0 and drawn strong', () => {
  const selected = treeLines(rows, branches, 'feat/x').find(line => line.key === 'feat/x')
  expect(selected?.text).toBe('›├─ feat/x     ↑2')
  expect(selected?.strong).toBe(true)
})

test('a lone main checkout draws only its root line', () => {
  expect(treeLines([main], [{ name: 'main', worktree: '/repo' }], undefined).map(line => line.text)).toEqual([' repo  main  ●1'])
})

test('the pane body: tree, blank, detail, blank, legend; the toggle removes the legend and its blank', () => {
  const withLegend = paneLines(rows, branches, true, undefined).map(line => line.text)
  const without = paneLines(rows, branches, false, undefined).map(line => line.text)
  expect(without.slice(7)).toEqual(['', 'main · HEAD 1234567', '/repo', '0 changed · 0 ahead · 0 behind · 1 live'])
  expect(withLegend).toEqual([...without, '', ...legendLines().map(line => line.text)])
  expect(legendLines().map(line => line.text)).toEqual(['↑ ahead  ↓ behind  ✎ changed  ● live', '⊘ detached  ⊗ prunable  › selected'])
})

test('a branch with no worktree still has a detail, so the selection never empties it', () => {
  expect(detailLines(rows, branches, 'feat/x').map(line => line.text)).toEqual(['feat/x · no worktree', '2 ahead · 0 behind'])
  expect(detailLines(rows, branches, 'detached:/repo/.claude/worktrees/old')[0]?.text).toBe('⊘ detached · HEAD 0000000')
})

test('a session inside a linked worktree counts for that worktree only, not the main checkout above it', () => {
  const counts = liveByTree(['/repo/.claude/worktrees/x/src', '/repo/src', '/repo/.claude/worktreesx'], ['/repo', '/repo/.claude/worktrees/x'])
  expect(counts.get('/repo/.claude/worktrees/x')).toBe(1)
  // Two sessions sit under /repo: /repo/src, and the look-alike /repo/.claude/worktreesx (not a child of worktrees/x).
  expect(counts.get('/repo')).toBe(2)
})

test('send-it on adds one header line above the tree; off leaves the pane unchanged', () => {
  const off = paneLines(rows, branches, false, undefined).map(line => line.text)
  expect(paneLines(rows, branches, false, undefined, false).map(line => line.text)).toEqual(off)
  const on = paneLines(rows, branches, false, undefined, true)
  expect(on[0]?.text).toBe('send-it ON · dontAsk · sandbox · auto-merge')
  expect(on.slice(1).map(line => line.text)).toEqual(off)
})
