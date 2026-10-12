import { expect, test } from 'claude-code/testing'

import { finalMessage, historyRows, HISTORY_PAGE_SIZE, leftReview, relativeTime, resultStyle } from './history'
import type { Task } from './pueue'

const now = Date.parse('2026-10-10T12:00:00Z')
const task = (id: number, state: Task['state'], endMs: number, command = 'pi --model openai/gpt:high --session-id pueue-x -p x'): Task => ({
  id, cwd: `/work/project-${id}`, state, command, startMs: endMs - 61_000, endMs,
  ...(state === 'Failed' ? { exit: 3 } : {}),
})

test('styles successful, review-pending, failed, and killed Pi tasks', () => {
  expect(resultStyle(task(1, 'Done', now), false)).toEqual({ glyph: '✓', result: 'success', tone: 'green' })
  expect(resultStyle({ ...task(2, 'Failed', now), exit: 1 }, true)).toEqual({ glyph: '✓', result: 'review', tone: 'yellow' })
  expect(resultStyle(task(3, 'Failed', now), false)).toEqual({ glyph: '✗', result: 'exit 3', tone: 'red' })
  expect(resultStyle(task(4, 'Killed', now), false)).toEqual({ glyph: '✗', result: 'killed', tone: 'mauve' })
})

test('sorts history newest first, filters results, and omits non-Pi dispatches', () => {
  const newest = task(1, 'Done', now - 1_000)
  const failed = { ...task(2, 'Failed', now - 2_000), exit: 1 }
  const killed = task(3, 'Killed', now - 3_000)
  const plainFalse = task(4, 'Failed', now - 4_000, 'false')
  const rows = historyRows([killed, plainFalse, failed, newest], { 2: 'pending' }, {}, now, 'all')
  expect(rows.map(row => row.task.id)).toEqual([1, 2, 3])
  expect(rows[1]).toMatchObject({ style: { glyph: '✓', result: 'review', tone: 'yellow' } })
  expect(historyRows([killed, failed, newest], {}, {}, now, 'failed').map(row => row.task.id)).toEqual([2])
  expect(historyRows([killed, failed, newest], {}, {}, now, 'killed').map(row => row.task.id)).toEqual([3])
})

test('uses the seven-day window and caps a page at fifty rows', () => {
  const fresh = Array.from({ length: HISTORY_PAGE_SIZE + 1 }, (_, index) => task(index + 1, 'Done', now - index * 1_000))
  const old = task(999, 'Done', now - 7 * 24 * 60 * 60 * 1_000 - 1)
  const rows = historyRows([...fresh, old], {}, {}, now, 'all')
  expect(rows).toHaveLength(HISTORY_PAGE_SIZE)
  expect(rows.some(row => row.task.id === 999)).toBe(false)
})

test('reports legacy usage as n/a and loaded session usage with known review outcomes', () => {
  const legacy = task(1, 'Done', now, 'pi --model openai/gpt:high -p x')
  const session = task(2, 'Done', now - 1_000)
  const [legacyRow, sessionRow] = historyRows([legacy, session], { 2: 'approved' }, { 2: { tokens: 1_500, cost: 0.2 } }, now, 'all')
  expect(legacyRow).toMatchObject({ usage: 'n/a' })
  expect(sessionRow).toMatchObject({ usage: '1.5k tok $0.20', review: 'approved', modelEffort: 'openai/gpt:high' })
})

test('a Failed(1) run that left a review stays yellow after the review is resolved', () => {
  expect(leftReview('agent-review: run session-band (d5766fbb-5733-4fad-b7c6-01b10bbb62bd) changed 7 file(s) and is awaiting review.')).toBe(true)
  expect(leftReview('agent-review: run 535eb0c6-7d15-4dc6-88d8-66332e10161f changed 9 file(s) and is awaiting review.')).toBe(true)
  expect(leftReview('agent-review: input refused, review x is pending.')).toBe(false)
  const approved = { ...task(1, 'Failed', now - 1_000), exit: 1 }
  const fromLog = { ...task(2, 'Failed', now - 2_000), exit: 1 }
  const crashed = { ...task(3, 'Failed', now - 3_000), exit: 1 }
  const rows = historyRows([approved, fromLog, crashed], { 1: 'approved' }, {}, now, 'all', new Set([2]))
  expect(rows.map(row => row.style.tone)).toEqual(['yellow', 'yellow', 'red'])
  expect(rows[0]).toMatchObject({ review: 'approved' })
})

test('formats relative time and extracts the final assistant text without partial JSONL', () => {
  expect(relativeTime(now - 3 * 60_000, now)).toBe('3m ago')
  expect(relativeTime(now - 26 * 60 * 60_000, now)).toBe('yesterday')
  const lines = [
    '{"partial":',
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: 'first' }] } }),
    JSON.stringify({ type: 'message', message: { role: 'assistant', content: [{ type: 'text', text: Array.from({ length: 22 }, (_, index) => `line ${index + 1}`).join('\n') }] } }),
  ].join('\n')
  const message = finalMessage(lines)
  expect(message?.split('\n')).toHaveLength(20)
  expect(message).toContain('line 22')
  expect(message).not.toContain('line 1\nline 2')
})
