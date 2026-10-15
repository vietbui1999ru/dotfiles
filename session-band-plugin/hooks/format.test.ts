import { expect, test } from 'claude-code/testing'

import { ctxLeft, shortDir, shortModel } from './format'

test('headroom is what is left of the context, never negative', () => {
  expect(ctxLeft(55)).toBe(45)
  expect(ctxLeft(100)).toBe(0)
  expect(ctxLeft(104)).toBe(0)
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
