import { expect, test } from 'claude-code/testing'

import type { WorktreeRow, WorktreeState } from '../types'
import { paneLines } from './worktree-pane.tsx'

const main: WorktreeRow = { path: '/repo', head: '1234567', branch: 'main', detached: false, prunable: false, changes: 0, ahead: 0, behind: 0, live: 1 }
const wt: WorktreeRow = { path: '/repo/.claude/worktrees/lightrag-opencode', head: 'abcdef1', branch: 'docs/laya', detached: false, prunable: false, changes: 2, ahead: 3, behind: 1, live: 0 }

const state: WorktreeState = {
  open: true,
  data: { rows: [main, wt], branches: [{ name: 'main', upstream: 'origin/main', worktree: '/repo' }, { name: 'feat/x' }], at: 0 },
}

test('each worktree row shows symbols, branch and path; the selected row is marked', () => {
  const lines = paneLines(state, wt).map(line => line.text)
  expect(lines[0]).toBe('  ⎇ ●1  main  /repo')
  expect(lines[1]).toBe('› ⎇ ↑3 ↓1 ✎2  docs/laya  /repo/.claude/worktrees/lightrag-opencode')
})

test('the selected worktree gets a detail line with counts', () => {
  const detail = paneLines(state, wt).find(line => line.text.includes('changed'))?.text
  expect(detail).toContain('⎇ docs/laya  3↑ 1↓  2 changed  0 live')
})

test('branches list shows which worktree has each one checked out', () => {
  const texts = paneLines(state, undefined).map(line => line.text)
  expect(texts).toContain('  ⎇ main  -> origin/main  [/repo]')
  expect(texts).toContain('  ⎇ feat/x')
})
