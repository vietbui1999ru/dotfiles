import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

import { newEvents, sync } from './mistake-sync.mjs'

const AT = Date.UTC(2026, 9, 16, 9, 0, 0)
const alert = { fingerprint: 'bash|git push|denied', at: AT, sessionId: 's1', cwd: '/Users/me/repos/private-repo', status: 'open' }

test('only normalized fields leave the machine: no full cwd path, and the repo name only', () => {
  const [event] = newEvents([alert], new Set())
  const parsed = JSON.parse(event.line)
  assert.equal(parsed.repo, 'private-repo')
  assert.equal(JSON.stringify(parsed).includes('/Users/me'), false)
  assert.equal(event.file, '2026-10.jsonl')
})

test('alerts already in the log are not written again', () => {
  const existing = new Set([`s1|${AT}|bash|git push|denied`])
  assert.deepEqual(newEvents([alert], existing), [])
})

test('sync appends new events to the monthly file and reports the count, without pushing when asked not to', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mistake-sync-'))
  const alertsPath = join(dir, 'alerts.json')
  const repo = join(dir, 'repo')
  mkdirSync(repo)
  writeFileSync(alertsPath, JSON.stringify({ alerts: [alert] }))
  assert.equal(sync({ alertsPath, repo, push: false }), 1)
  assert.equal(sync({ alertsPath, repo, push: false }), 0)
  const files = readdirSync(join(repo, 'events'))
  assert.deepEqual(files, ['2026-10.jsonl'])
  assert.equal(readFileSync(join(repo, 'events', '2026-10.jsonl'), 'utf8').trim().split('\n').length, 1)
})

const git = (cwd, ...args) => execFileSync('git', ['-C', cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim()

// A working clone of a bare remote, so push and HEAD movement are observable.
const cloneRepo = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mistake-sync-git-'))
  const bare = join(dir, 'remote.git')
  const repo = join(dir, 'repo')
  execFileSync('git', ['init', '-q', '--bare', '-b', 'main', bare])
  execFileSync('git', ['init', '-q', '-b', 'main', repo])
  git(repo, 'remote', 'add', 'origin', bare)
  writeFileSync(join(repo, 'README.md'), 'events\n')
  git(repo, 'add', 'README.md')
  git(repo, 'commit', '-qm', 'init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  return { dir, bare, repo }
}

test('sync refuses to commit or push an event that carries a key-shaped value', () => {
  const { dir, bare, repo } = cloneRepo()
  const alertsPath = join(dir, 'alerts.json')
  const fake = 'sk-' + 'a'.repeat(32)
  writeFileSync(alertsPath, JSON.stringify({ alerts: [{ ...alert, fingerprint: `bash|curl ${fake}|other` }] }))
  const headBefore = git(repo, 'rev-parse', 'HEAD')
  const remoteBefore = git(bare, 'rev-parse', 'main')
  assert.throws(() => sync({ alertsPath, repo, push: true }), err => {
    assert.match(err.message, /secret-scan/)
    assert.match(err.message, /openai-style-key/)
    assert.equal(err.message.includes(fake), false)
    return true
  })
  assert.equal(git(repo, 'rev-parse', 'HEAD'), headBefore)
  assert.equal(git(bare, 'rev-parse', 'main'), remoteBefore)
  assert.equal(git(repo, 'diff', '--cached', '--name-only'), '')
})

test('sync commits and pushes a clean alert to the remote', () => {
  const { dir, bare, repo } = cloneRepo()
  const alertsPath = join(dir, 'alerts.json')
  writeFileSync(alertsPath, JSON.stringify({ alerts: [alert] }))
  const headBefore = git(repo, 'rev-parse', 'HEAD')
  assert.equal(sync({ alertsPath, repo, push: true }), 1)
  assert.notEqual(git(repo, 'rev-parse', 'HEAD'), headBefore)
  assert.equal(git(bare, 'rev-parse', 'main'), git(repo, 'rev-parse', 'HEAD'))
})
