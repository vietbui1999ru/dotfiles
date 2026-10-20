import { expect, test } from 'claude-code/testing'

import { forgeById, forgeFor, hostOf } from './forge'

test('hostOf reads https, ssh:// and scp-style remotes, and nothing else', () => {
  expect(hostOf('https://github.com/vietbui99/dotfiles.git\n')).toBe('github.com')
  expect(hostOf('https://oauth2:token@GitLab.example.com/group/sub/repo.git')).toBe('gitlab.example.com')
  expect(hostOf('ssh://git@gitlab.com:2222/group/repo.git')).toBe('gitlab.com')
  expect(hostOf('git@github.com:vietbui99/dotfiles.git')).toBe('github.com')
  expect(hostOf('codeberg.org:owner/repo')).toBe('codeberg.org')
  expect(hostOf('/Users/me/repos/local.git')).toBeUndefined()
  expect(hostOf('')).toBeUndefined()
})

test('forgeFor picks github, gitlab (self-hosted too), or nothing', () => {
  expect(forgeFor('github.com')?.id).toBe('github')
  expect(forgeFor('gitlab.com')?.id).toBe('gitlab')
  expect(forgeFor('gitlab.example.com')?.id).toBe('gitlab')
  expect(forgeFor('codeberg.org')).toBeUndefined()
  expect(forgeFor('github.example.com')).toBeUndefined()
  expect([forgeById('github')?.sigil, forgeById('gitlab')?.sigil, forgeById(undefined)]).toEqual(['#', '!', undefined])
})
