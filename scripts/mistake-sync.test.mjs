import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
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
