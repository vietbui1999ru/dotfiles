import { expect, test } from 'claude-code/testing'

import { SEND_IT_BLOCK, acceptsOrigin, disable, enable, isEligible, isOn, refusedRepos } from './send-it'

const recent = '2026-11-01T00:00:00Z'
const home = '/Users/test'

test('refusedRepos returns the three absolute common dirs under HOME', () => {
  expect(refusedRepos(home)).toEqual(['/Users/test/dotfiles/.git', '/Users/test/repos/llm-wiki/.git', '/Users/test/repos/agent-events/.git'])
})

test('the three repos are refused, and so is a worktree of each (it reports the common dir)', () => {
  for (const repo of refusedRepos(home)) expect(isEligible(repo, recent, home)).toBe(false)
  expect(isEligible(`${home}/repos/llm-wiki/.git`, '', home)).toBe(false)
})

test('matching is exact: the same suffix under another home is eligible', () => {
  expect(isEligible('/Users/other/dotfiles/.git', recent, home)).toBe(true)
  expect(isEligible('/Users/test/code/dotfiles/.git', recent, home)).toBe(true)
})

test('a root commit before SEND_IT_SINCE is refused; on or after it is eligible', () => {
  expect(isEligible(`${home}/code/old/.git`, '2026-10-15T23:59:59Z', home)).toBe(false)
  expect(isEligible(`${home}/code/new/.git`, '2026-10-16T00:00:00Z', home)).toBe(true)
  expect(isEligible(`${home}/code/new/.git`, recent, home)).toBe(true)
})

test('an empty repo is eligible; an unparseable root date is refused', () => {
  expect(isEligible(`${home}/code/empty/.git`, '', home)).toBe(true)
  expect(isEligible(`${home}/code/bad/.git`, 'not-a-date', home)).toBe(false)
})

test('only the composer origin is accepted', () => {
  expect(acceptsOrigin('composer')).toBe(true)
  for (const kind of ['cli', 'pane', 'hook', 'schedule', 'Composer', '']) expect(acceptsOrigin(kind)).toBe(false)
})

test('enable then disable returns the original text exactly', () => {
  const text = '{\n  "model": "sonnet",\n  "env": {\n    "A": "1"\n  }\n}\n'
  expect(disable(enable(text))).toBe(text)
  expect(disable(enable('{}\n'))).toBe('{}\n')
})

test('enable writes the block and keeps the other keys', () => {
  const on = JSON.parse(enable('{\n  "model": "sonnet"\n}\n'))
  expect(on.model).toBe('sonnet')
  expect(on.send_it_block).toEqual(SEND_IT_BLOCK)
  expect(SEND_IT_BLOCK).toEqual({
    env: { SEND_IT: '1', SEND_IT_ENV: '~/.config/send-it/.env' },
    model: 'opus',
    permissions: { defaultMode: 'dontAsk' },
  })
})

test('malformed JSON throws in every function and is never returned', () => {
  const broken = '{"model": '
  expect(() => enable(broken)).toThrow('malformed')
  expect(() => disable(broken)).toThrow('malformed')
  expect(() => isOn(broken)).toThrow('malformed')
  expect(() => enable('[1, 2]')).toThrow('not an object')
})

test('isOn reflects enable and disable', () => {
  const text = '{\n  "model": "sonnet"\n}\n'
  expect(isOn(text)).toBe(false)
  expect(isOn(enable(text))).toBe(true)
  expect(isOn(disable(enable(text)))).toBe(false)
})
