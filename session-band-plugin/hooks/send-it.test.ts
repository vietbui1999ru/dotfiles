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

test('SEND_IT_BLOCK has the plan v2 keys with the exact values', () => {
  expect(SEND_IT_BLOCK).toEqual({
    env: { SEND_IT: '1', SEND_IT_ENV: '~/.config/send-it/.env' },
    model: 'opus',
    permissions: {
      defaultMode: 'dontAsk',
      allow: ['Bash', 'Edit', 'Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'Agent', 'Skill', 'mcp__context7', 'mcp__qmd', 'mcp__firecrawl'],
      deny: [
        'AskUserQuestion',
        'Read(~/secrets/**)',
        'Edit(./.claude/settings*.json)',
        'Edit(./.claude/{hooks,agents,rules,commands,skills}/**)',
        'Edit(./.mcp.json)',
        'Edit(./.git/hooks/**)',
      ],
    },
    sandbox: {
      enabled: true,
      allowUnsandboxedCommands: false,
      filesystem: {
        denyRead: ['~/secrets'],
        denyWrite: ['~/.claude', '~/dotfiles', '~/repos/llm-wiki', '~/repos/agent-events', '~/.config/send-it', './.git/hooks', './.mcp.json'],
      },
      network: { allowedDomains: ['github.com', 'api.github.com', '*.githubusercontent.com', 'registry.npmjs.org'] },
    },
  })
  expect(SEND_IT_BLOCK).not.toHaveProperty('excludedCommands')
})

test('enable on "{}" writes the real settings keys and no marker key', () => {
  const on = JSON.parse(enable('{}\n'))
  expect(on.env.SEND_IT).toBe('1')
  expect(on.model).toBe('opus')
  expect(on.permissions.defaultMode).toBe('dontAsk')
  expect(on.sandbox.enabled).toBe(true)
  expect(on.sandbox.allowUnsandboxedCommands).toBe(false)
  expect(Object.keys(on).sort()).toEqual(['env', 'model', 'permissions', 'sandbox'])
})

test('enable keeps an existing unrelated key and an existing allow entry', () => {
  const on = JSON.parse(enable('{\n  "theme": "dark",\n  "permissions": {\n    "allow": ["Bash(git status)"]\n  }\n}\n'))
  expect(on.theme).toBe('dark')
  expect(on.permissions.allow).toContain('Bash(git status)')
  expect(on.permissions.allow).toContain('Bash')
})

test('enable twice gives the same text as once (no duplicate allow/deny entries)', () => {
  const once = enable('{}\n')
  expect(enable(once)).toBe(once)
})

const refusal = (json: string): string => {
  try {
    enable(json)
  } catch (err) {
    return (err as Error).message
  }
  throw new Error('expected enable to throw')
}

test('enable refuses a model other than opus and names only the key', () => {
  const message = refusal('{"model": "sonnet"}\n')
  expect(message).toContain('model')
  expect(message).not.toContain('sonnet')
})

test('enable refuses a different sandbox and names only the key', () => {
  const message = refusal('{"sandbox": {"enabled": false, "network": {"allowedDomains": ["example.org"]}}}\n')
  expect(message).toContain('sandbox')
  expect(message).not.toContain('example.org')
})

test('enable refuses a different env.SEND_IT and names the key', () => {
  expect(refusal('{"env": {"SEND_IT": "0"}}\n')).toContain('env.SEND_IT')
})

test('enable on a file that already holds the block values does not throw', () => {
  const block = JSON.stringify(SEND_IT_BLOCK)
  expect(enable(block)).toBe(enable(enable(block)))
})

test('enable then disable on the formatted input returns the original text exactly', () => {
  const text = '{\n  "theme": "dark",\n  "env": {\n    "A": "1"\n  }\n}\n'
  expect(disable(enable(text))).toBe(text)
  expect(disable(enable('{}\n'))).toBe('{}\n')
})

test('disable keeps the unrelated key and the original allow entry', () => {
  const text = '{\n  "theme": "dark",\n  "permissions": {\n    "allow": ["Bash(git status)"]\n  }\n}\n'
  const off = JSON.parse(disable(enable(text)))
  expect(off.theme).toBe('dark')
  expect(off.permissions).toEqual({ allow: ['Bash(git status)'] })
})

test('malformed JSON throws in every function and is never returned', () => {
  const broken = '{"model": '
  expect(() => enable(broken)).toThrow('malformed')
  expect(() => disable(broken)).toThrow('malformed')
  expect(() => isOn(broken)).toThrow('malformed')
  expect(() => enable('[1, 2]')).toThrow('not an object')
  expect(() => disable('[1, 2]')).toThrow('not an object')
})

test('isOn is true after enable, false after disable, false on "{}"', () => {
  expect(isOn('{}\n')).toBe(false)
  expect(isOn(enable('{}\n'))).toBe(true)
  expect(isOn(disable(enable('{}\n')))).toBe(false)
})
