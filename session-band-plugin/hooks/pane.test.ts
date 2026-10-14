import { expect, test } from 'claude-code/testing'

import { confirmedStale, continueArgv, continueModel, continuePath, hasMonitorRows, monitorText, selectedProgress, selectedTask } from './pane.tsx'
import { controlArgv } from './controls'
import { selectStale, type MonitorRow, type TrackedTask } from './handoff'
import { emptyProgress } from './pisession'

const task: TrackedTask = { id: 7, cwd: '/repo', addedMs: 0, sessionId: 'pueue-x', label: 'edit', task: { id: 7, cwd: '/repo', command: 'pi --model openai/gpt:high -p x', state: 'Done' } }

test('builds only tracked-task control and Continue argv', () => {
  expect(controlArgv('kill', [7])).toEqual(['pueue', 'kill', '7'])
  const argv = continueArgv(task, 'openai/gpt:high', '/tmp/pi-continue-pueue-x-1.md')!
  expect(argv.slice(0, 7)).toEqual(['pueue', 'add', '-i', '--print-task-id', '--label', 'edit', '--'])
  expect(argv[7]).toContain("cat '/tmp/pi-continue-pueue-x-1.md'")
  expect(argv[7]).not.toContain('follow-up text')
  expect(continueModel(task, { ...emptyProgress(), model: 'anthropic/sonnet', effort: 'low' })).toBe('anthropic/sonnet:low')
  expect(continueModel({ ...task, task: { ...task.task!, command: 'pi -p x' } }, undefined)).toBeUndefined()
})

test('shows the Monitor only for tracked rows and follows the selected task transcript', () => {
  const second = { ...task, id: 8, addedMs: 8, task: { ...task.task!, state: 'Running' as const } }
  expect(hasMonitorRows([])).toBe(false)
  expect(hasMonitorRows([{ id: 7 } as MonitorRow])).toBe(true)
  const pi = selectedProgress([task, second], 8, {
    7: { ...emptyProgress(), entries: [{ kind: 'text', text: 'first' }] },
    8: { ...emptyProgress(), entries: [{ kind: 'text', text: 'second' }] },
  })
  expect(pi?.entries[0]?.text).toBe('second')
})

test('narrow monitor rows drop cost, tokens, and model before truncating activity', () => {
  const row: MonitorRow = { id: 7, state: 'Running', glyph: '▶', modelEffort: 'openai/gpt:high', elapsed: '1m0s', activity: 'bash this is a long command that needs truncating', tokens: '1.5k tok', cost: '$0.20' }
  const full = monitorText(row, 200)
  const noCost = monitorText(row, full.length - 1)
  const noTokens = monitorText(row, noCost.length - 1)
  const noModel = monitorText(row, noTokens.length - 1)
  const narrow = monitorText(row, 16)
  expect(full).toContain('$0.20')
  expect(noCost).not.toContain('$0.20')
  expect(noTokens).not.toContain('1.5k tok')
  expect(noModel).not.toContain('openai/gpt:high')
  expect(narrow).toContain('▶ #7')
  expect(narrow).toContain('1m0s')
  expect(narrow).toContain('…')
})

test('two quick Continues create distinct prompt paths', () => {
  expect(continuePath('/tmp', 'pueue-x', 1_000)).not.toBe(continuePath('/tmp', 'pueue-x', 1_001))
})

test('selects an explicit task, otherwise the newest running task', () => {
  const done = { ...task, id: 5, addedMs: 5 }
  const oldRunning = { ...task, id: 6, addedMs: 6, task: { ...task.task!, state: 'Running' as const } }
  const newRunning = { ...task, id: 8, addedMs: 8, task: { ...task.task!, state: 'Running' as const } }
  expect(selectedTask([done, oldRunning, newRunning], 5)?.id).toBe(5)
  expect(selectedTask([done, oldRunning, newRunning])?.id).toBe(8)
  expect(selectedTask([done])?.id).toBe(5)
})

test('Clean stale does not remove a session made fresh after its dry run', () => {
  const old = { ...task, task: { ...task.task!, endMs: 0 } }
  const now = 8 * 24 * 60 * 60 * 1000
  const dryRun = selectStale([old], [{ path: '/pi/a', name: 'a_pueue-x.jsonl', mtimeMs: 0, size: 1 }], now)
  const fresh = selectStale([old], [{ path: '/pi/a', name: 'a_pueue-x.jsonl', mtimeMs: now, size: 1 }], now)
  expect(confirmedStale({ selection: dryRun, atMs: now }, fresh, now + 1)).toBeUndefined()
  expect(confirmedStale({ selection: dryRun, atMs: now }, dryRun, now + 60_001)).toBeUndefined()
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

test('default selection prefers a task with a visible monitor row', () => {
  const oldDone = { ...task, id: 9, addedMs: 9 }
  const queued = { ...task, id: 6, addedMs: 6, task: { ...task.task!, state: 'Queued' as const } }
  expect(selectedTask([queued, oldDone], undefined, [6])?.id).toBe(6)
  expect(selectedTask([queued, oldDone], 9, [6])?.id).toBe(9)
  expect(selectedTask([oldDone], undefined, [])?.id).toBe(9)
  expect(selectedProgress([queued, oldDone], undefined, { 6: { ...emptyProgress(), tokens: 6 } }, [6])?.tokens).toBe(6)
})

test('Continue reads a quoted --model from a previous Continue without the quotes', () => {
  const quoted = { ...task, task: { ...task.task!, command: "pi --model 'anthropic/x:high' --session-id 'pueue-x' -p \"$(cat '/tmp/p.md')\" < /dev/null" } }
  expect(continueModel(quoted, undefined)).toBe('anthropic/x:high')
  expect(continueModel({ ...task, task: { ...task.task!, command: 'pi -p x' } }, undefined)).toBeUndefined()
})
