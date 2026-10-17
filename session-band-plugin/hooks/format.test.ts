import { expect, test } from 'claude-code/testing'

import { ctxBar, shortDir, shortModel } from './format'

test('context bar fills with block glyphs and carries the percentage in its middle', () => {
  expect(ctxBar(0)).toBe('░░░░░0%░░░░░')
  expect(ctxBar(50)).toBe('████50%░░░░░')
  expect(ctxBar(100)).toBe('████100%████')
  expect(ctxBar(12.5)).toBe('█▌░░13%░░░░░')
})

test('shortDir keeps two segments under home, ~ at home itself', () => {
  expect(shortDir('/Users/me', '/Users/me')).toBe('~')
  expect(shortDir('/Users/me/dotfiles', '/Users/me')).toBe('dotfiles')
  expect(shortDir('/Users/me/repos/llm-wiki/notes', '/Users/me')).toBe('llm-wiki/notes')
  expect(shortDir('/srv/app/api', '/Users/me')).toBe('app/api')
  expect(shortDir('/tmp', undefined)).toBe('tmp')
})

test('shortModel drops the claude- prefix', () => {
  expect(shortModel('claude-sonnet-5-5')).toBe('sonnet-5-5')
  expect(shortModel('opus')).toBe('opus')
})
