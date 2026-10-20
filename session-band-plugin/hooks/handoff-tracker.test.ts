import { expect, test } from 'claude-code/testing'

import { hasLiveTrackedTask, trackedFrom } from './handoff.tsx'
import type { Task } from './pueue'

const task = (id: number, overrides: Partial<Task> = {}): Task => ({
  id, cwd: '/repo', command: 'pi --model openai/gpt:high --session-id pueue-a -p "$(cat /tmp/a)" < /dev/null', state: 'Queued', createdMs: 100, ...overrides,
})

test('tracks captured and parallel Pi adds, not stdout-dependent commands', () => {
  const tracked = trackedFrom([task(1), task(2)], 99, '/repo', '/repo')
  expect(tracked.map(item => item.id)).toEqual([1, 2])
  expect(tracked[0]).toMatchObject({ sessionId: 'pueue-a' })
})

test('does not run the poller when no tracked task is live', () => {
  const tracked = (id: number, state: Task['state']) => ({ id, cwd: '/repo', addedMs: 100, task: task(id, { state }) })
  expect(hasLiveTrackedTask([tracked(1, 'Done'), tracked(2, 'Failed'), tracked(3, 'Killed')])).toBe(false)
  expect(hasLiveTrackedTask([tracked(4, 'Paused')])).toBe(true)
})

test('does not track non-Pi, older, or out-of-repository pueue tasks', () => {
  const result = trackedFrom([
    task(1, { command: 'false' }),
    task(2, { createdMs: 98 }),
    task(3, { cwd: '/outside' }),
    task(4, { cwd: '/repo/worktree' }),
  ], 99, '/repo', '/repo')
  expect(result.map(item => item.id)).toEqual([4])
})

test('tracks a labelled dispatch into a sibling worktree when its label is in the dispatching command', () => {
  const dispatched = 'pueue add --print-task-id --label pane-keys-9e4b27d1 -w /wt/pane-keys -- "pi --model m -p x"'
  const result = trackedFrom([
    task(1, { cwd: '/wt/pane-keys', label: 'pane-keys-9e4b27d1' }),
    task(2, { cwd: '/wt/other', label: 'other-1234abcd' }),
    task(3, { cwd: '/wt/pane-keys', label: 'pane-keys' }),
    task(4, { cwd: '/wt/pane-keys' }),
  ], 99, '/wt/session', '/wt/session', dispatched)
  expect(result.map(item => item.id)).toEqual([1])
})
