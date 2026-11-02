import { expect, test } from 'claude-code/testing'

import { capPercent, guardAgent, softStop, type SoftStopCheck } from './threshold'

const base: SoftStopCheck = { tokens: 400_000, tool: 'Read', nowMs: 1_000_000, isNotified: false }

test('only an Agent spawn at 350000 tokens or more is refused', () => {
  expect(guardAgent(350_000, 'Agent')).toContain('Agent spawns are blocked')
  expect(guardAgent(349_999, 'Agent')).toBeUndefined()
  expect(guardAgent(900_000, 'Bash')).toBeUndefined()
  expect(guardAgent(undefined, 'Agent')).toBeUndefined()
})

test('soft stop clears below 350000 tokens and fires at 350000; no reading passes', () => {
  expect(softStop({ ...base, tokens: 349_999 })).toEqual({ action: 'clear' })
  expect(softStop({ ...base, tokens: 350_000 }).action).toBe('notify')
  expect(softStop({ ...base, tokens: undefined })).toEqual({ action: 'pass' })
})

test('ctx percent is measured against the 500K cap, not the model window', () => {
  expect(capPercent(250_000)).toBe(50)
  expect(capPercent(350_000)).toBe(70)
  expect(capPercent(undefined)).toBeUndefined()
})

test('first crossing is the long directive, then the short re-fire', () => {
  const first = softStop(base)
  const again = softStop({ ...base, isNotified: true })
  expect(first.action === 'notify' && first.text).toContain('Last tool completed')
  expect(again.action === 'notify' && again.text).toContain('still 70%+')
})

test('agent tasks get the task-scoped directive', () => {
  const r = softStop({ ...base, taskId: 'TASK-7' })
  expect(r.action === 'notify' && r.text).toContain('.agents/claimed/TASK-7.state.md')
})

test('save-critical writes pass, by path and by Bash command', () => {
  expect(softStop({ ...base, tool: 'Write', filePath: '/r/.claude/session-state.md' })).toEqual({ action: 'pass' })
  expect(softStop({ ...base, tool: 'Write', filePath: '/u/memory/x.md' })).toEqual({ action: 'pass' })
  expect(softStop({ ...base, tool: 'Bash', command: 'sed -i s/a/b/ .agents/claimed/T.state.md' })).toEqual({ action: 'pass' })
  expect(softStop({ ...base, tool: 'Read', command: 'session-state.md' }).action).toBe('notify')
})

test('a save within 5 minutes is debounced, an older one is not', () => {
  expect(softStop({ ...base, lastSavedMs: base.nowMs - 299_000 })).toEqual({ action: 'pass' })
  expect(softStop({ ...base, lastSavedMs: base.nowMs - 301_000 }).action).toBe('notify')
})
