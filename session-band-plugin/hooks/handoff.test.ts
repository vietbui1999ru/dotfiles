import { expect, test } from 'claude-code/testing'

import { formatElapsed, formatTokens, selectStale, summarize, type TrackedTask } from './handoff'
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

test('reads pending and accepted or changed review decisions', () => {
  const pending = parsePending(JSON.stringify({ runId: 'r', files: [{ file: 'a.ts' }] }))
  expect(pending).toMatchObject({ runId: 'r' })
  expect(reviewState([pending!], [])).toBe('pending')
  expect(reviewState([], [{ files: [{ accepted: true }] }])).toBe('approved')
  expect(reviewState([], [{ files: [{ accepted: false }], notes: 'fix' }])).toBe('changes requested')
})

test('summarizes lifecycle states, failures, rollups, and stale scoped files', () => {
  const progress = fold(emptyProgress(), `${JSON.stringify({ type: 'message', message: { role: 'assistant', usage: { totalTokens: 1530, cost: { total: 0.2 } }, content: [] } })}\n`)
  const single = summarize([running()], { 7: progress }, { 7: 'pending' }, 5_000)
  expect(single?.text).toContain('pi#7▶')
  expect(single?.text).toContain('1.5k tok')
  expect(single?.review).toBe('pending')
  const failure = summarize([{ ...running(), task: { ...running().task!, state: 'Failed', exit: 3 } }], {}, {}, 5_000)
  expect(failure?.text).toContain('exit 3')
  expect(summarize([running(7), running(8)], {}, {}, 5_000)?.text).toBe('pi 2▶')
  expect(summarize([{ ...running(), task: { ...running().task!, state: 'Done', endMs: 1_000 }, finishedMs: 1_000 }], {}, {}, 32_000)).toBeNull()
  const old = { ...running(), addedMs: 0, task: { ...running().task!, state: 'Done', endMs: 0 } }
  const stale = selectStale([old], [{ path: '/pi/x', name: 'x_pueue-task-7.jsonl', mtimeMs: 0, size: 4 }, { path: '/pi/no', name: 'other.jsonl', mtimeMs: 0, size: 99 }], 8 * 24 * 60 * 60 * 1000)
  expect(stale).toMatchObject({ bytes: 4 })
  expect(formatElapsed(61_000)).toBe('1m1s')
  expect(formatTokens(1_500)).toBe('1.5k')
})
