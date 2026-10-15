import { expect, test } from 'claude-code/testing'

import { ctxTone, limitTone } from './palette'

test('context goes green, then orange from 40, then red from the 70% clear line', () => {
  expect(ctxTone(39)).toBe('green')
  expect(ctxTone(40)).toBe('orange')
  expect(ctxTone(69)).toBe('orange')
  expect(ctxTone(70)).toBe('red')
})

test('rate limits keep their own late thresholds', () => {
  expect(limitTone(69)).toBe('green')
  expect(limitTone(70)).toBe('yellow')
  expect(limitTone(90)).toBe('red')
})
