import { expect, test } from 'claude-code/testing'

import { continueArgv, controlArgv, selectedTask } from './pane.tsx'
import { selectStale, type TrackedTask } from './handoff'

const task: TrackedTask = { id: 7, cwd: '/repo', addedMs: 0, sessionId: 'pueue-x', label: 'edit', task: { id: 7, cwd: '/repo', command: 'pi --model openai/gpt:high -p x', state: 'Done' } }

test('builds only tracked-task control and Continue argv', () => {
  expect(controlArgv(task, 'kill')).toEqual(['pueue', 'kill', '7'])
  expect(controlArgv({ ...task, task: { ...task.task!, state: 'Running' } }, 'remove')).toBeUndefined()
  const argv = continueArgv(task, 'openai/gpt:high', '/tmp/pi-continue-pueue-x-1.md')
  expect(argv.slice(0, 7)).toEqual(['pueue', 'add', '-i', '--print-task-id', '--label', 'edit', '--'])
  expect(argv[7]).toContain("cat '/tmp/pi-continue-pueue-x-1.md'")
  expect(argv[7]).not.toContain('follow-up text')
})

test('selects an explicit task, otherwise the newest running task', () => {
  const done = { ...task, id: 5, addedMs: 5 }
  const oldRunning = { ...task, id: 6, addedMs: 6, task: { ...task.task!, state: 'Running' as const } }
  const newRunning = { ...task, id: 8, addedMs: 8, task: { ...task.task!, state: 'Running' as const } }
  expect(selectedTask([done, oldRunning, newRunning], 5)?.id).toBe(5)
  expect(selectedTask([done, oldRunning, newRunning])?.id).toBe(8)
  expect(selectedTask([done])?.id).toBe(5)
})

test('Clean stale excludes unrelated Pi and agent sessions', () => {
  const old = { ...task, task: { ...task.task!, endMs: 0 } }
  const selection = selectStale([old], [
    { path: '/pi/a', name: 'a_pueue-x.jsonl', mtimeMs: 0, size: 1 },
    { path: '/pi/b', name: 'b_pueue-other.jsonl', mtimeMs: 0, size: 2 },
    { path: '/repo/.agents/sessions/a.md', name: 'a.md', mtimeMs: 0, size: 3 },
  ], 8 * 24 * 60 * 60 * 1000)
  expect(selection.sessions.map(session => session.path)).toEqual(['/pi/a'])
})
