import { expect, test } from 'claude-code/testing'

import { approvalAction, approveArgv, matchingSocket, needsRejectConfirm, pendingRecordFor, rejectToast, reviewPaneRunArgv, reviewRemoteArgv, reviewSplitArgv } from './pane.tsx'
import type { TrackedTask } from './handoff'

test('Open review picks the Neovim serving the matching repository or worktree', () => {
  expect(matchingSocket('/repo', [{ path: '/tmp/a', cwd: '/other' }, { path: '/tmp/b', cwd: '/repo/worktree' }])).toBe('/tmp/b')
  expect(matchingSocket('/repo', [{ path: '/tmp/a', cwd: '/other' }])).toBeUndefined()
  expect(matchingSocket('/repo', [{ path: '/tmp/home', cwd: '/' }])).toBeUndefined()
  expect(reviewSplitArgv('/repo')).toEqual(['herdr', 'pane', 'split', '--current', '--direction', 'right', '--cwd', '/repo'])
  expect(reviewPaneRunArgv('w1:p2', '/tmp/nvim')).toEqual(['herdr', 'pane', 'run', 'w1:p2', 'nvim', '--listen', '/tmp/nvim'])
})

test('Approve and review commands use only the gate and Neovim contracts', () => {
  expect(approveArgv('/Users/test', 'run-1')).toEqual(['/Users/test/dotfiles/scripts/agent-review', 'approve', 'run-1'])
  expect(reviewRemoteArgv('/tmp/nvim', 'AgentReview')).toEqual(['nvim', '--server', '/tmp/nvim', '--remote-send', '<C-\\><C-N>:AgentReview<CR>'])
  expect(reviewRemoteArgv('/tmp/nvim', 'AgentReviewRejectAll')).toEqual(['nvim', '--server', '/tmp/nvim', '--remote-send', '<C-\\><C-N>:AgentReviewRejectAll<CR>'])
  expect(approvalAction('{"ok":true}')).toBe('approved')
  expect(approvalAction('{"ok":true}', 'command not found')).toBe('approved')
  expect(approvalAction('{"ok":false,"reason":"tree-changed"}')).toBe('open-review')
  expect(approvalAction('')).toBe('unavailable')
  expect(rejectToast(0)).toBe('Sent Reject all to Neovim; the decision appears in the band when recorded.')
  expect(rejectToast(1)).toBe('Could not send Reject all to Neovim.')
})

test('selects the task pending record, otherwise the oldest non-error record', () => {
  const task = { id: 1, cwd: '/repo', addedMs: 0, runId: 'mine' } satisfies TrackedTask
  const records = [
    { runId: 'newer', files: [], startedAt: 20 },
    { runId: 'oldest', files: [], startedAt: 10 },
    { runId: 'failed', files: [], startedAt: 0, error: true as const },
    { runId: 'mine', files: [], startedAt: 30 },
  ]
  expect(pendingRecordFor(task, records)?.runId).toBe('mine')
  expect(pendingRecordFor({ ...task, runId: undefined }, records)?.runId).toBe('oldest')
})

test('Reject all requires a second press for the same pending run', () => {
  expect(needsRejectConfirm(undefined, 'run-1')).toBe(true)
  expect(needsRejectConfirm('run-1', 'run-1')).toBe(false)
  expect(needsRejectConfirm('run-2', 'run-1')).toBe(true)
})
