// The `gh pr list` fixture both draft-prs tests share, and the rows and summary it draws at NOW.
export const NOW = Date.parse('2026-10-19T12:00:00Z')

const run = (status: string, conclusion = '') => [{ __typename: 'CheckRun', status, conclusion }]
const url = (n: number) => `https://github.com/vietbui99/dotfiles/pull/${n}`

export const PRS = [
  { number: 115, title: 'feat(session-band): icon chips for worktrees and Pi history', headRefName: 'band-icon-chips', url: url(115), isDraft: false, state: 'MERGED', mergedAt: '2026-10-16T12:00:00Z', updatedAt: '2026-10-16T12:00:00Z', statusCheckRollup: run('COMPLETED', 'FAILURE') },
  { number: 116, title: 'feat(session-band): icon-only chips, no brackets', headRefName: 'band-icon-only', url: url(116), isDraft: true, state: 'OPEN', mergedAt: null, updatedAt: '2026-10-19T10:00:00Z', statusCheckRollup: run('COMPLETED', 'SUCCESS') },
  { number: 117, title: 'fix(pi): reload keys', headRefName: 'pi-reload', url: url(117), isDraft: false, state: 'OPEN', mergedAt: null, updatedAt: '2026-10-19T11:45:00Z', statusCheckRollup: run('IN_PROGRESS') },
  { number: 110, title: 'an older merge', headRefName: 'old-merge', url: url(110), isDraft: false, state: 'MERGED', mergedAt: '2026-10-09T12:00:00Z', updatedAt: '2026-10-09T12:00:00Z', statusCheckRollup: [] },
  { number: 109, title: 'a closed PR', headRefName: 'closed', url: url(109), isDraft: false, state: 'CLOSED', mergedAt: null, updatedAt: '2026-10-18T12:00:00Z', statusCheckRollup: null },
]

// Each row as drawn after its mark and check glyph: prefix-free title padded to 44, then age.
export const ROWS = [
  `#116 ${'icon-only chips, no brackets'.padEnd(44)}  2h`,
  `#117 ${'reload keys'.padEnd(44)}  15m`,
  `#115 ${'icon chips for worktrees and Pi history'.padEnd(44)}  3d`,
]

export const HEADERS = ['Draft · 1', 'Ready · 1', 'Merged 7d · 1']
