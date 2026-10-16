import { expect, test } from 'claude-code/testing'

import { handoffText } from './band-text'

test('renders a full single Pi handoff segment and retains required fields when narrow', () => {
  const handoff = { kind: 'single' as const, text: '', id: 12, glyph: '!', state: 'Failed' as const, model: 'openai/gpt', effort: 'high', elapsed: '3m', tokens: '12k', cost: '$0.10', files: 2, label: 'fix', review: 'changes requested' as const, exit: 1 }
  expect(handoffText(handoff)).toBe('pi#12! openai/gpt:high 3m 12k tok $0.10 2 files fix changes requested exit 1')
  expect(handoffText(handoff, 45)).toBe('pi#12! openai/gpt:high changes requested exit 1')
})

test('renders rollups and leaves a no-handoff band path unchanged', () => {
  expect(handoffText({ kind: 'rollup', text: 'pi 2▶ 1✓', running: 2, done: 1 })).toBe('pi 2▶ 1✓')
})
