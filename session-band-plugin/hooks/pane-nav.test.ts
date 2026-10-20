import { expect, test } from 'claude-code/testing'

import { MOD_PANES, nextPane, PANE_TITLES, switchSteps } from './pane-nav'

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

test('switching closes the focused pane, opens the target focused, then reopens the first pane behind it', () => {
  expect(switchSteps('pi-handoff', 'pi-history')).toEqual([
    { close: 'pi-handoff' },
    { open: 'pi-history', title: 'Pi history', focus: true },
    { open: 'pi-handoff', title: 'Pi hand-off' },
  ])
})

test('no switch when there is nowhere else to go', () => {
  expect(switchSteps('pi-handoff', undefined)).toEqual([])
  expect(switchSteps('pi-handoff', 'pi-handoff')).toEqual([])
})

test('every mod pane has a real title, so a switch never retitles a tab to its bare id', () => {
  for (const id of MOD_PANES) expect(PANE_TITLES[id]).not.toBe(id)
})
