import { expect, test } from 'claude-code/testing'

import { prLine } from './draft-prs'
import { GLAB_AUTH, GLAB_MISSING, GLAB_UNREADABLE, pickMrs, readGlab } from './gitlab'
import { MRS, NOW, ORDER } from './gitlab-fixture'

test('pickMrs keeps opened MRs and merges from the last 7 days, drafts first, newest first', () => {
  const mrs = pickMrs(MRS, NOW)
  expect(mrs.map(mr => mr.number)).toEqual(ORDER)
  expect(mrs.map(mr => mr.state)).toEqual(['draft', 'draft', 'ready', 'merged'])
  expect(mrs.every(mr => mr.checks === 'none')).toBe(true)
  expect(mrs[0]).toEqual({ number: 16, title: 'Draft: wip parser', branch: 'wip-parser', url: 'https://gitlab.com/group/repo/-/merge_requests/16', state: 'draft', checks: 'none', at: Date.parse('2026-10-19T10:00:00Z') })
  expect(mrs[3]?.at).toBe(Date.parse('2026-10-16T12:00:00Z'))
})

test('an MR row uses the ! sigil', () => {
  const [mr] = pickMrs(MRS, NOW)
  expect(mr && prLine(mr, NOW, '!')).toBe(`!16 ${'wip parser'.padEnd(44)}  2h`)
})

test('readGlab names each way glab can fail', () => {
  const glab = (exitCode: number, stdout = '', stderr = '') => ({ exitCode, stdout, stderr })
  expect(readGlab(undefined, NOW).error).toBe(GLAB_MISSING)
  expect(readGlab(glab(1, '', 'GET https://gitlab.com/api/v4/projects/x/merge_requests: 401 {message: 401 Unauthorized}'), NOW).error).toBe(GLAB_AUTH)
  expect(readGlab(glab(1, '', 'none of the git remotes point to a known host. Run glab auth login'), NOW).error).toBe(GLAB_AUTH)
  expect(readGlab(glab(1, '', `${'x'.repeat(90)}\nsecond line`), NOW).error).toBe(`glab failed (exit 1): ${'x'.repeat(80)}`)
  expect([readGlab(glab(0, 'not json'), NOW).error, readGlab(glab(0, '{}'), NOW).error]).toEqual([GLAB_UNREADABLE, GLAB_UNREADABLE])
  expect(readGlab(glab(0, JSON.stringify(MRS)), NOW)).toEqual({ prs: pickMrs(MRS, NOW), error: undefined })
})
