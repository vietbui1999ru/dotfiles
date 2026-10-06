import { expect, test } from 'claude-code/testing'

import { shortDir, shortModel } from './format'

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
