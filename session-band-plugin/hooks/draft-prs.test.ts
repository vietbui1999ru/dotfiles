import { expect, test } from 'claude-code/testing'

import { age, CHECK_MARK, GH_AUTH, GH_MISSING, GH_NOT_REPO, GH_UNREADABLE, groups, pickPrs, prLine, readGh, rollup } from './draft-prs'
import { HEADERS, NOW, PRS, ROWS } from './draft-prs-fixture'

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

test('rows and groups: number, prefix-free title cut at 44, age; one header per non-empty state', () => {
  const prs = pickPrs(PRS, NOW)
  expect(prs.map(pr => prLine(pr, NOW))).toEqual(ROWS)
  expect(groups(prs).map(group => group.header)).toEqual(HEADERS)
  expect(groups(prs.filter(pr => pr.state !== 'ready')).map(group => group.header)).toEqual(['Draft · 1', 'Merged 7d · 1'])
  const long = { ...prs[0], title: 'refactor(x)!: ' + 'y'.repeat(60) }
  expect(prLine(long, NOW)).toBe(`#116 ${'y'.repeat(43)}…  2h`)
  expect(prLine({ ...prs[0], title: 'feat: ' }, NOW).startsWith('#116 feat: ')).toBe(true)
  expect([CHECK_MARK.passing.glyph, CHECK_MARK.failing.glyph, CHECK_MARK.pending.glyph, CHECK_MARK.none.glyph]).toEqual(['✓', '✗', '•', '·'])
  expect([age(59_000), age(15 * 60_000), age(2 * 3_600_000), age(3 * 86_400_000)]).toEqual(['now', '15m', '2h', '3d'])
})
