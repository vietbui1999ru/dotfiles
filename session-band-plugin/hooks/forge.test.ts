import { expect, test } from 'claude-code/testing'

import { forgeById, forgeFor, hostOf, pickRemote } from './forge'

const v = (...rows: [string, string][]) => rows.map(([name, url]) => `${name}\t${url} (fetch)\n${name}\t${url} (push)`).join('\n')

test('pickRemote prefers origin on a known forge, else any remote on one, else names a host', () => {
  expect(pickRemote(v(['gitlab', 'https://gitlab.weconex.vn/data/ai-gateway.git']))).toMatchObject({ host: 'gitlab.weconex.vn', forge: { id: 'gitlab' } })
  expect(pickRemote(v(['upstream', 'git@gitlab.com:g/r.git'], ['origin', 'git@github.com:me/r.git'])).forge?.id).toBe('github')
  expect(pickRemote(v(['origin', 'https://codeberg.org/me/r.git'], ['mirror', 'git@github.com:me/r.git'])).forge?.id).toBe('github')
  expect(pickRemote(v(['origin', 'https://codeberg.org/me/r.git']))).toEqual({ host: 'codeberg.org', forge: undefined })
  expect([pickRemote(''), pickRemote(v(['local', '/srv/repo.git']))]).toEqual([{}, {}])
})

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
