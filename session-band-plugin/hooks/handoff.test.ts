import { expect, test } from 'claude-code/testing'

import { activityLabel, formatElapsed, formatTokens, idleAge, monitorRows, selectStale, summarize, type TrackedTask } from './handoff'
import { STUCK_MS, type CheckRecord } from './outcome'
import { trackedFrom } from './handoff.tsx'
import { emptyProgress, fold } from './pisession'
import { dispatchCommand, isPiDispatch, parseAddResult, parsePiCommand, parseStatus } from './pueue'
import { parsePending, reviewState } from './review'

const running = (id = 7): TrackedTask => ({
  id, cwd: '/repo', addedMs: 0, sessionId: `pueue-task-${id}`, label: 'edit',
  task: { id, cwd: '/repo', command: 'pi --model openai/gpt:high -p x', state: 'Running', startMs: 1_000 },
})

const PUEUE = JSON.stringify({ tasks: {
  '7': { id: 7, label: 'ok', path: '/repo', command: 'pi --model openai/gpt:high --session-id pueue-ok -p "$(cat /tmp/p)" < /dev/null', created_at: '2026-10-10T00:00:00Z', status: { Running: { enqueued_at: '2026-10-10T00:00:00Z', start: '2026-10-10T00:00:01Z' } } },
  '8': { id: 8, label: null, path: '/repo', command: 'false', created_at: '2026-10-10T00:00:00Z', status: { Done: { enqueued_at: '2026-10-10T00:00:00Z', start: '2026-10-10T00:00:01Z', end: '2026-10-10T00:00:02Z', result: { Failed: 1 } } } },
  '9': { id: 9, label: null, path: '/repo', command: 'sleep 1', created_at: '2026-10-10T00:00:00Z', status: { Done: { enqueued_at: '2026-10-10T00:00:00Z', start: '2026-10-10T00:00:01Z', end: '2026-10-10T00:00:02Z', result: 'Killed' } } },
} })

test('parses real pueue running, failed, and killed status shapes', () => {
  const [one, failed, killed] = parseStatus(PUEUE)
  expect(one).toMatchObject({ id: 7, state: 'Running', label: 'ok' })
  expect(failed).toMatchObject({ id: 8, state: 'Failed', exit: 1 })
  expect(killed).toMatchObject({ id: 9, state: 'Killed' })
})

test('recognizes and decodes Pi dispatches without trusting add stdout', () => {
  expect(isPiDispatch('pi --model openai/gpt:high --session-id pueue-x -p "$(cat /tmp/a)" < /dev/null')).toBe(true)
  expect(isPiDispatch('pueue add -- false')).toBe(false)
  // parsePiCommand tracks a pi reached by any path, so the controls must accept the same command.
  expect(isPiDispatch('/opt/tools/bin/pi --model x/y -p hi')).toBe(true)
  expect(isPiDispatch('./pip -p x')).toBe(false)
  expect(parseAddResult(' 42\n')).toBe(42)
  expect(parseAddResult('task 42')).toBeUndefined()
  expect(parsePiCommand("pi --model openai/gpt:high --thinking medium --session-id pueue-x --label x -p ok")).toEqual({ model: 'openai/gpt', effort: 'medium', sessionId: 'pueue-x', label: 'x' })
  expect(dispatchCommand('openai/gpt:high', 'pueue-x', '/tmp/a b.md')).toContain("cat '/tmp/a b.md'")
})

test('folds session JSONL incrementally, preserving partial lines and bounded entries', () => {
  const line = JSON.stringify({ type: 'message', message: { role: 'assistant', provider: 'openai', model: 'gpt', usage: { totalTokens: 1200, cost: { total: 0.012 } }, content: [{ type: 'text', text: 'working' }, { type: 'toolCall', name: 'edit', arguments: { path: 'a.ts' } }] } })
  let progress = fold(emptyProgress(), `${JSON.stringify({ type: 'thinking_level_change', thinkingLevel: 'high' })}\n${line.slice(0, 20)}`)
  expect(progress.tokens).toBe(0)
  progress = fold(progress, `${line.slice(20)}\n`)
  expect(progress).toMatchObject({ tokens: 1200, cost: 0.012, model: 'openai/gpt', effort: 'high', lastActivity: 'edit a.ts', files: ['a.ts'] })
  expect(progress.entries.map(item => item.text)).toEqual(['working', 'edit a.ts'])
})

test('tracks the newest valid Pi event timestamp', () => {
  const chunk = [
    { type: 'session', timestamp: '2026-10-10T00:00:01.000Z' },
    { type: 'model_change', timestamp: '2026-10-10T00:00:03.000Z', provider: 'openai', modelId: 'gpt' },
    { type: 'message', timestamp: '2026-10-10T00:00:02.000Z', message: { role: 'assistant', content: [] } },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  const latest = fold(emptyProgress(), chunk)
  expect(latest.lastEventMs).toBe(Date.parse('2026-10-10T00:00:03.000Z'))
  const unchanged = fold({ ...latest, lastEventMs: 9 }, `${JSON.stringify({ type: 'session', timestamp: 'not-a-date' })}\n`)
  expect(unchanged.lastEventMs).toBe(9)
  expect(fold(latest, '').lastEventMs).toBe(latest.lastEventMs)
})

test('builds ordered monitor rows with idle states and legacy fallbacks', () => {
  const at = 1_000_000
  const rows = [
    { ...running(1), task: { ...running(1).task!, state: 'Done' as const, endMs: at - 4 } },
    { ...running(2), task: { ...running(2).task!, state: 'Queued' as const } },
    { ...running(3), task: { ...running(3).task!, state: 'Paused' as const } },
    { ...running(4), task: { ...running(4).task!, state: 'Failed' as const, endMs: 3 } },
    { ...running(5), task: { ...running(5).task!, state: 'Running' as const } },
    { ...running(6), task: { ...running(6).task!, state: 'Done' as const, endMs: at - 3 } },
  ]
  const monitor = monitorRows(rows, {}, rows.map(row => row.task!), at)
  expect(monitor.map(row => [row.id, row.glyph])).toEqual([[4, '✗'], [5, '▶'], [2, '◌'], [3, '⏸'], [6, '✓'], [1, '✓']])
  const task = running().task!
  const progress = { ...emptyProgress(), lastEventMs: at - 31_000 }
  expect(idleAge({ ...progress, lastEventMs: at - 29_000 }, task, at)).toBeUndefined()
  expect(idleAge(progress, task, at)).toEqual({ text: 'idle 31s', tone: 'muted' })
  expect(idleAge({ ...progress, lastEventMs: at - 119_000 }, task, at)?.tone).toBe('muted')
  expect(idleAge({ ...progress, lastEventMs: at - 121_000 }, task, at)?.tone).toBe('yellow')
  expect(idleAge({ ...progress, lastEventMs: at - 299_000 }, task, at)?.tone).toBe('yellow')
  // A running task's red is the stuck outcome's job now, so its idle timer stops at yellow.
  expect(idleAge({ ...progress, lastEventMs: at - 301_000 }, task, at)?.tone).toBe('yellow')
  expect(idleAge({ ...progress, lastEventMs: at - 301_000 }, { ...task, state: 'Paused' }, at)?.tone).toBe('red')
  expect(activityLabel({ ...emptyProgress(), lastEventAssistant: true })).toBe('thinking')
  expect(activityLabel(emptyProgress())).toBe('starting')
  const legacy = { ...running(9), sessionId: undefined, label: 'legacy' }
  const legacyRow = monitorRows([legacy], {}, [legacy.task!], at)[0]!
  expect(legacyRow).toMatchObject({ id: 9, activity: 'n/a', tokens: 'n/a', cost: 'n/a', label: 'legacy' })
})

test('a row shows checks passed in green', () => {
  const at = 1_000_000
  const item = { ...running(1), task: { ...running(1).task!, state: 'Done' as const, endMs: at - 1_000 } }
  const check: CheckRecord = { phase: 'done', commit: 'c1', diffHash: 'd1', specStatus: 'approved', passed: true, round: 0, steered: false }
  const [row] = monitorRows([item], {}, [item.task!], at, undefined, { 1: { reviewPending: false, check, head: { commit: 'c1', diffHash: 'd1' } } })
  expect(row).toMatchObject({ outcome: 'checks passed', tone: 'green' })
})

test('a row shows fixing 2/3', () => {
  const item = running(2)
  const check: CheckRecord = { phase: 'done', commit: 'c2', diffHash: 'd2', specStatus: 'approved', passed: false, round: 2, steered: true }
  const [row] = monitorRows([item], {}, [item.task!], 5_000, undefined, { 2: { reviewPending: false, check, head: { commit: 'c2', diffHash: 'd2' } } })
  expect(row).toMatchObject({ outcome: 'fixing', tone: 'yellow', round: 2 })
})

test('a review-waiting row keeps its marker', () => {
  const item = { ...running(3), task: { ...running(3).task!, state: 'Failed' as const, exit: 3, endMs: 1_000 } }
  const [row] = monitorRows([item], {}, [item.task!], 5_000, undefined, { 3: { reviewPending: true } })
  expect(row).toMatchObject({ outcome: 'finished', tone: 'muted', reviewWaiting: true })
})

test('a stuck row replaces the red idle tone', () => {
  const at = 1_000_000
  const item = running(4)
  const [row] = monitorRows([item], { 4: { ...emptyProgress(), lastEventMs: at - STUCK_MS - 1 } }, [item.task!], at, undefined, {
    4: { reviewPending: false, agentStatus: 'working', logAgeMs: STUCK_MS + 1 },
  })
  expect(row).toMatchObject({ outcome: 'stuck', tone: 'red', idle: { tone: 'yellow' } })
})

test('exit 3 sorts with finished tasks, not failed ones', () => {
  const at = 1_000_000
  const failed = { ...running(1), task: { ...running(1).task!, state: 'Failed' as const, exit: 2, endMs: at - 1_000 } }
  const review = { ...running(2), task: { ...running(2).task!, state: 'Failed' as const, exit: 3, endMs: at - 2_000 } }
  const done = { ...running(3), task: { ...running(3).task!, state: 'Done' as const, endMs: at - 3_000 } }
  const rows = monitorRows([review, failed, done], {}, [review.task!, failed.task!, done.task!], at, undefined, { 2: { reviewPending: true } })
  expect(rows.map(row => row.id)).toEqual([1, 2, 3])
})

test('a multi-line bash command becomes a single-line activity', () => {
  const call = { type: 'message', timestamp: '2026-10-10T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: 'cd x &&\n  make\ttest' } }] } }
  expect(fold(emptyProgress(), `${JSON.stringify(call)}\n`).lastActivity).toBe('bash cd x && make test')
})

test('a newer non-message event keeps the assistant thinking flag', () => {
  const chunk = [
    { type: 'message', timestamp: '2026-10-10T00:00:01.000Z', message: { role: 'assistant', content: [{ type: 'text', text: 'plan' }] } },
    { type: 'thinking_level_change', timestamp: '2026-10-10T00:00:02.000Z', thinkingLevel: 'high' },
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  expect(activityLabel(fold(emptyProgress(), chunk))).toBe('thinking')
})

test('a pi-view prefix keeps dispatch parsing and tracking intact', () => {
  // What the dispatch rule will send: the viewer wrapper, then Pi's own command.
  const command = '"$HOME/dotfiles/scripts/pi-view" pi --model opencode-go/x:high --session-id pueue-a -p "$(cat /tmp/p)" < /dev/null'
  expect(isPiDispatch(command)).toBe(true)
  expect(parsePiCommand(command)).toEqual({ model: 'opencode-go/x', effort: 'high', sessionId: 'pueue-a' })
  const task = { id: 12, cwd: '/repo', command, state: 'Queued' as const, createdMs: 100 }
  expect(trackedFrom([task], 99, '/repo', '/repo').map(item => [item.id, item.sessionId])).toEqual([[12, 'pueue-a']])
})

test('a --live pi-view dispatch keeps dispatch parsing and tracking intact', () => {
  const command = '"$HOME/dotfiles/scripts/pi-view" --live pi --model opencode-go/x:high --session-id pueue-a -p "$(cat /tmp/p)" < /dev/null'
  expect(isPiDispatch(command)).toBe(true)
  expect(parsePiCommand(command)).toEqual({ model: 'opencode-go/x', effort: 'high', sessionId: 'pueue-a' })
  const task = { id: 13, cwd: '/repo', command, state: 'Queued' as const, createdMs: 100 }
  expect(trackedFrom([task], 99, '/repo', '/repo').map(item => [item.id, item.sessionId])).toEqual([[13, 'pueue-a']])
})

test('a --tui pi-view dispatch keeps dispatch parsing and tracking intact', () => {
  const command = '"$HOME/dotfiles/scripts/pi-view" --tui pi --model opencode-go/x:high --session-id pueue-a -p "$(cat /tmp/p)" < /dev/null'
  expect(isPiDispatch(command)).toBe(true)
  expect(parsePiCommand(command)).toEqual({ model: 'opencode-go/x', effort: 'high', sessionId: 'pueue-a' })
  const task = { id: 14, cwd: '/repo', command, state: 'Queued' as const, createdMs: 100 }
  expect(trackedFrom([task], 99, '/repo', '/repo').map(item => [item.id, item.sessionId])).toEqual([[14, 'pueue-a']])
})

test('reads pending and accepted or changed review decisions', () => {
  const pending = parsePending(JSON.stringify({ runId: 'r', files: [{ file: 'a.ts' }] }))
  expect(pending).toMatchObject({ runId: 'r' })
  const approved = { files: [{ file: 'a.ts', status: 'accepted' }], notes: [], patch: '' }
  expect(reviewState(pending, undefined)).toBe('pending')
  expect(reviewState(pending, approved)).toBe('decided, waiting for the next Pi run in this repo')
  expect(reviewState(undefined, approved)).toBe('approved')
  expect(reviewState(undefined, { files: [{ file: 'a.ts', status: 'changed' }], notes: ['fix'], patch: '' })).toBe('changes requested')
  expect(reviewState(undefined, { files: [{ file: 'a.ts', status: 'accepted' }], notes: [], patch: 'diff', skipped: true })).toBe('changes requested')
})

test('summarizes lifecycle states, failures, rollups, and stale scoped files', () => {
  const progress = fold(emptyProgress(), `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { totalTokens: 1530, cost: { total: 0.2 } }, content: [] } })}\n`)
  const single = summarize([running()], { 7: progress }, { 7: 'pending' }, 5_000)
  expect(single?.text).toContain('pi#7▶')
  expect(single?.text).toContain('1.5k tok')
  expect(single?.review).toBe('pending')
  const failure = summarize([{ ...running(), task: { ...running().task!, state: 'Failed', exit: 3 } }], {}, {}, 5_000)
  expect(failure?.state).toBe('Failed')
  expect(failure?.text).toContain('exit 3')
  const reviewPending = summarize([{ ...running(), task: { ...running().task!, state: 'Failed' as const, exit: 1, endMs: 1_000 } }], {}, { 7: 'pending' }, 1_000_000)
  expect(reviewPending).toMatchObject({ state: 'Done', review: 'pending' })
  expect(reviewPending?.text).toContain('pi#7✓')
  expect(reviewPending?.text).not.toContain('exit 1')
  expect(summarize([running(7), running(8)], {}, {}, 5_000)?.text).toBe('pi 2▶')
  expect(summarize([{ ...running(), task: { ...running().task!, state: 'Done', endMs: 1_000 }, finishedMs: 1_000 }], {}, {}, 32_000)).toBeNull()
  const old: TrackedTask = { ...running(), addedMs: 0, task: { ...running().task!, state: 'Done' as const, endMs: 0 } }
  const stale = selectStale([old], [{ path: '/pi/x', name: 'x_pueue-task-7.jsonl', mtimeMs: 0, size: 4 }, { path: '/pi/no', name: 'other.jsonl', mtimeMs: 0, size: 99 }], 8 * 24 * 60 * 60 * 1000)
  expect(stale).toMatchObject({ bytes: 4 })
  expect(formatElapsed(61_000)).toBe('1m1s')
  expect(formatTokens(1_500)).toBe('1.5k')
})
