import { expect, test } from 'claude-code/testing'

import { openForSession, parseAlerts, recentAlerts, type MistakeAlert } from './mistake-alerts'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 9, 15)

const alerts: MistakeAlert[] = [
  { fingerprint: 'a', at: NOW - 1000, sessionId: 's1', status: 'open' },
  { fingerprint: 'b', at: NOW - 2000, sessionId: 's1', status: 'recorded' },
  { fingerprint: 'c', at: NOW - 3000, sessionId: 's2', status: 'open' },
  { fingerprint: 'd', at: NOW - 20 * DAY, sessionId: 's3', status: 'open' },
]

test('the band counts only this session\'s open alerts', () => {
  expect(openForSession(alerts, 's1')).toBe(1)
  expect(openForSession(alerts, 's9')).toBe(0)
})

test('the pane lists the last 14 days across sessions, newest first', () => {
  expect(recentAlerts(alerts, NOW).map(alert => alert.fingerprint)).toEqual(['a', 'b', 'c'])
})

test('a missing or broken alerts file reads as no alerts', () => {
  expect(parseAlerts(undefined)).toEqual([])
  expect(parseAlerts('not json')).toEqual([])
  expect(parseAlerts('{"alerts":"x"}')).toEqual([])
})
