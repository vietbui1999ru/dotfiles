import { expect, test } from 'claude-code/testing'

import type { WorktreeBranch, WorktreeRow } from '../types'
import { treeItems, treeKeys, treeLines } from './worktrees'

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

test('the tree: root, a separator, one branch group per line, worktrees nested under their branch', () => {
  expect(treeLines(rows, branches, false, undefined).map(line => line.text)).toEqual([
    ' repo  main  ●1',
    '|',
    ' |__ docs/laya  ✎2',
    '|   \\__ lightrag-opencode',
    ' |__ feat/x  ↑2',
    ' \\__ ⊘ 0000000',
    '    \\__ old',
  ])
})

test('the selected line is marked with a chevron', () => {
  const selected = treeLines(rows, branches, false, 'feat/x').find(line => line.key === 'feat/x')
  expect(selected?.text).toBe('›|__ feat/x  ↑2')
})

test('the legend is a first line that the toggle removes', () => {
  const withLegend = treeLines(rows, branches, true, undefined)
  expect(withLegend[0].text.startsWith('⎇ branch')).toBe(true)
  expect(withLegend[1].text).toBe('')
  expect(withLegend.length).toBe(treeLines(rows, branches, false, undefined).length + 2)
})

test('a lone main checkout draws only its root line', () => {
  expect(treeLines([main], [{ name: 'main', worktree: '/repo' }], false, undefined).map(line => line.text)).toEqual([' repo  main  ●1'])
})
