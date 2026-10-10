import { expect, test } from 'claude-code/testing'

import { approvalAction, approveArgv, matchingSocket, needsRejectConfirm, reviewPaneRunArgv, reviewRemoteArgv, reviewSplitArgv } from './pane.tsx'

test('Open review picks the Neovim serving the matching repository or worktree', () => {
  expect(matchingSocket('/repo', [{ path: '/tmp/a', cwd: '/other' }, { path: '/tmp/b', cwd: '/repo/worktree' }])).toBe('/tmp/b')
  expect(matchingSocket('/repo', [{ path: '/tmp/a', cwd: '/other' }])).toBeUndefined()
  expect(reviewSplitArgv('/repo')).toEqual(['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/repo'])
  expect(reviewPaneRunArgv('w1:p2', '/tmp/nvim')).toEqual(['herdr', 'pane', 'run', 'w1:p2', 'nvim', '--listen', '/tmp/nvim'])
})

test('Approve and review commands use only the gate and Neovim contracts', () => {
  expect(approveArgv('run-1')).toEqual(['agent-review', 'approve', 'run-1'])
  expect(reviewRemoteArgv('/tmp/nvim', 'AgentReview')).toEqual(['nvim', '--server', '/tmp/nvim', '--remote-send', '<C-\\><C-N>:AgentReview<CR>'])
  expect(reviewRemoteArgv('/tmp/nvim', 'AgentReviewRejectAll')).toEqual(['nvim', '--server', '/tmp/nvim', '--remote-send', '<C-\\><C-N>:AgentReviewRejectAll<CR>'])
  expect(approvalAction('{"ok":true}')).toBe('approved')
  expect(approvalAction('{"ok":false,"reason":"tree-changed"}')).toBe('open-review')
  expect(approvalAction('', 'command not found')).toBe('unavailable')
})

test('Reject all requires a second press for the same pending run', () => {
  expect(needsRejectConfirm(undefined, 'run-1')).toBe(true)
  expect(needsRejectConfirm('run-1', 'run-1')).toBe(false)
  expect(needsRejectConfirm('run-2', 'run-1')).toBe(true)
})
