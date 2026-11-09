import { expect, test } from 'claude-code/testing'

import { AUTO_CLEAR_TOKENS, COMPACT_CEILING_TOKENS, introText, readClearResult, shouldClear, shouldSkipCompact, type ClearCheck } from './auto-clear'

const base: ClearCheck = { isTaskSession: false, turnReason: 'answer', tokens: 350_000, agentsBusy: false, draft: '', saveFailed: false }

test('the clear threshold is the 70% soft-stop threshold, 350K tokens', () => {
  expect(AUTO_CLEAR_TOKENS).toBe(350_000)
  expect(COMPACT_CEILING_TOKENS).toBe(900_000)
})

test('shouldClear fires at 350,000 tokens and not at 349,999', () => {
  expect(shouldClear({ ...base, tokens: 349_999 })).toBe(false)
  expect(shouldClear({ ...base, tokens: 350_000 })).toBe(true)
  expect(shouldClear({ ...base, tokens: undefined })).toBe(false)
})

test('shouldClear refuses a sub-agent, a task session, a turn that did not answer, busy agents, a typed draft, or a failed save', () => {
  expect(shouldClear({ ...base, agentId: 'a1' })).toBe(false)
  expect(shouldClear({ ...base, isTaskSession: true })).toBe(false)
  for (const turnReason of ['aborted', 'refusal', 'error']) expect(shouldClear({ ...base, turnReason })).toBe(false)
  expect(shouldClear({ ...base, agentsBusy: true })).toBe(false)
  expect(shouldClear({ ...base, draft: 'half a thought' })).toBe(false)
  expect(shouldClear({ ...base, saveFailed: true })).toBe(false)
})

test('a whitespace-only draft does not block the clear', () => {
  expect(shouldClear({ ...base, draft: '   \n' })).toBe(true)
})

test('shouldSkipCompact holds only for an auto compaction below the ceiling in a main session', () => {
  const skip = { trigger: 'auto', isTaskSession: false, tokens: 500_000, saveFailed: false }
  expect(shouldSkipCompact(skip)).toBe(true)
  expect(shouldSkipCompact({ ...skip, trigger: 'manual' })).toBe(false)
  expect(shouldSkipCompact({ ...skip, agentId: 'a1' })).toBe(false)
  expect(shouldSkipCompact({ ...skip, isTaskSession: true })).toBe(false)
  expect(shouldSkipCompact({ ...skip, tokens: COMPACT_CEILING_TOKENS })).toBe(false)
  expect(shouldSkipCompact({ ...skip, tokens: COMPACT_CEILING_TOKENS - 1 })).toBe(true)
  expect(shouldSkipCompact({ ...skip, saveFailed: true })).toBe(false)
  expect(shouldSkipCompact({ ...skip, tokens: undefined })).toBe(true)
})

test('readClearResult reads a saved path, a failure, or a clean clear', () => {
  expect(readClearResult('Session saved: .agents/sessions/x.md')).toEqual({ kind: 'saved', path: '.agents/sessions/x.md' })
  expect(readClearResult('Clear cancelled: nothing was saved.')).toEqual({ kind: 'failed', text: 'Clear cancelled: nothing was saved.' })
  expect(readClearResult('Clear cancelled: the save step failed.').kind).toBe('failed')
  expect(readClearResult('Clear refused: the transcript is already gone, nothing to summarise. Run save-session first, or re-run /clear.').kind).toBe('failed')
  expect(readClearResult('cleared')).toEqual({ kind: 'cleared' })
})

test('introText names the saved path and the rounded token count', () => {
  const text = introText(351_400, { kind: 'saved', path: '.agents/sessions/x.md' })
  expect(text).toContain('auto-cleared at about 351K tokens')
  expect(text).toContain('saved to .agents/sessions/x.md')
  expect(text).toContain('goal, what is done, and what is next')
  expect(text).toContain('Wait for my confirmation before acting')
})

test('introText without a path points at agent-session active', () => {
  const text = introText(undefined, { kind: 'cleared' })
  expect(text).not.toContain('K tokens')
  expect(text).toContain('agent-session active')
})
