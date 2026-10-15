import { expect, test } from 'claude-code/testing'

import { nextPane } from './pane-nav'

test('cycles forward and backward through the open mod panes, wrapping at both ends', () => {
  const open = ['pi-handoff', 'worktrees', 'pi-history']
  expect(nextPane(open, 'pi-handoff', 1)).toBe('pi-history')
  expect(nextPane(open, 'pi-history', 1)).toBe('worktrees')
  expect(nextPane(open, 'pi-handoff', -1)).toBe('worktrees')
})

test('skips panes that are not open, and ignores panes this mod does not draw', () => {
  expect(nextPane(['pi-handoff', 'worktrees'], 'pi-handoff', 1)).toBe('worktrees')
  expect(nextPane(['pi-handoff', 'some-other-plugin'], 'pi-handoff', 1)).toBe('pi-handoff')
})

test('from a pane that is not open, lands on the first open mod pane; with none open, nothing', () => {
  expect(nextPane(['worktrees'], 'pi-history', 1)).toBe('worktrees')
  expect(nextPane(['some-other-plugin'], 'worktrees', 1)).toBeUndefined()
})
