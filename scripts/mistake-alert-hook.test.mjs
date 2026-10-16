import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { handleFailure } from './mistake-alert-hook.mjs'

const NOW = Date.UTC(2026, 9, 15)
const failure = (overrides = {}) => ({
  tool_name: 'Bash',
  tool_input: { command: 'docling --output out/x.md in.pdf' },
  error: 'Exit code 2\nerror: unknown option --output-dir',
  session_id: 'sess-1',
  cwd: '/repo/wt',
  ...overrides,
})

const paths = () => {
  const dir = mkdtempSync(join(tmpdir(), 'mistake-hook-'))
  return { mapPath: join(dir, 'map.json'), alertsPath: join(dir, 'alerts.json') }
}

test('the third identical failure alerts with additionalContext for the agent and records the alert', () => {
  const opts = paths()
  assert.equal(handleFailure(failure(), { ...opts, now: NOW }), undefined)
  assert.equal(handleFailure(failure(), { ...opts, now: NOW + 1 }), undefined)
  const out = handleFailure(failure(), { ...opts, now: NOW + 2 })
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUseFailure')
  assert.match(out.hookSpecificOutput.additionalContext, /Repeated mistake: bash\|docling --output\|unknown-flag/)
  const alerts = JSON.parse(readFileSync(opts.alertsPath, 'utf8')).alerts
  assert.equal(alerts.length, 1)
  assert.equal(alerts[0].sessionId, 'sess-1')
  assert.equal(alerts[0].status, 'open')
})

test('a fourth failure in the same window stays quiet', () => {
  const opts = paths()
  for (let i = 0; i < 3; i++) handleFailure(failure(), { ...opts, now: NOW + i })
  assert.equal(handleFailure(failure(), { ...opts, now: NOW + 3 }), undefined)
})

test('non-Bash tools and interrupts are ignored and do not count', () => {
  const opts = paths()
  for (let i = 0; i < 5; i++) handleFailure(failure({ tool_name: 'Edit' }), { ...opts, now: NOW + i })
  for (let i = 0; i < 5; i++) handleFailure(failure({ is_interrupt: true }), { ...opts, now: NOW + i })
  assert.equal(existsSync(opts.alertsPath), false)
})
