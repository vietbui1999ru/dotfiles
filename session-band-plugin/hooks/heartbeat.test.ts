import { expect, test } from 'claude-code/testing'

import { heartbeatBody, heartbeatPath } from './heartbeat'

test('heartbeat file sits in TMPDIR, keyed by session id', () => {
  expect(heartbeatPath('/var/folders/T', '0f3e-9a')).toBe('/var/folders/T/session-band-0f3e-9a.alive')
})

test('a session id that could escape the directory gets no path', () => {
  expect(heartbeatPath('/var/folders/T', '../etc/passwd')).toBeUndefined()
  expect(heartbeatPath('/var/folders/T', '')).toBeUndefined()
})

test('heartbeat body is the unix time in whole seconds', () => {
  expect(heartbeatBody(1_791_400_000_999, '/repo/wt')).toBe('1791400000\t/repo/wt\n')
})
