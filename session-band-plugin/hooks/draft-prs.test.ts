import { expect, test } from 'claude-code/testing'

import { age, GH_AUTH, GH_MISSING, GH_NOT_REPO, GH_UNREADABLE, pickPrs, prLine, readGh, rollup, summaryLine } from './draft-prs'
import { NOW, PRS, ROWS, SUMMARY } from './draft-prs-fixture'

test('checks roll up: failing beats pending, pending beats passing, nothing is none', () => {
  expect([rollup(null), rollup(undefined), rollup([])]).toEqual(['none', 'none', 'none'])
  expect(rollup([{ status: 'COMPLETED', conclusion: 'SKIPPED' }, { status: 'COMPLETED', conclusion: 'NEUTRAL' }, { state: 'SUCCESS' }])).toBe('passing')
  expect(rollup([{ status: 'QUEUED', conclusion: '' }, { state: 'SUCCESS' }])).toBe('pending')
  expect(rollup([{ state: 'EXPECTED' }])).toBe('pending')
  expect(rollup([{ status: 'IN_PROGRESS', conclusion: '' }, { state: 'ERROR' }])).toBe('failing')
  expect(rollup([{ status: 'COMPLETED', conclusion: 'TIMED_OUT' }, { state: 'PENDING' }])).toBe('failing')
})

test('drafts, then ready, then merged in the last 7 days; closed and older merged drop out', () => {
  expect(pickPrs(PRS, NOW).map(pr => pr.number)).toEqual([116, 117, 115])
})

test('a gh failure becomes a message, never a throw', () => {
  const gh = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr })
  expect(readGh(undefined, NOW).error).toBe(GH_MISSING)
  expect(readGh(gh(4), NOW).error).toBe(GH_AUTH)
  expect(readGh(gh(1, '', 'none of the git remotes configured for this repository point to a known GitHub host'), NOW).error).toBe(GH_NOT_REPO)
  expect(readGh(gh(1, '', 'fatal: not a git repository (or any of the parent directories): .git'), NOW).error).toBe(GH_NOT_REPO)
  expect(readGh(gh(2, '', `${'x'.repeat(90)}\nsecond line`), NOW).error).toBe(`gh failed (exit 2): ${'x'.repeat(80)}`)
  expect([readGh(gh(0, 'not json'), NOW).error, readGh(gh(0, '{}'), NOW).error]).toEqual([GH_UNREADABLE, GH_UNREADABLE])
  expect(readGh(gh(0, JSON.stringify(PRS)), NOW)).toEqual({ prs: pickPrs(PRS, NOW), error: undefined })
})

test('rows and summary: mark, state, checks, title cut at 50, branch, age', () => {
  const prs = pickPrs(PRS, NOW)
  expect(prs.map((pr, index) => prLine(pr, index === 0, NOW))).toEqual(ROWS)
  expect(summaryLine(prs)).toBe(SUMMARY)
  expect([age(59_000), age(15 * 60_000), age(2 * 3_600_000), age(3 * 86_400_000)]).toEqual(['now', '15m', '2h', '3d'])
})
