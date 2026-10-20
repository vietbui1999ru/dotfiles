// A fake `glab mr list --output json`, with the same timeline as draft-prs-fixture.ts. Fields are GitLab's MR API names.
export { NOW } from './draft-prs-fixture'

const url = (n: number) => `https://gitlab.com/group/repo/-/merge_requests/${n}`

export const MRS = [
  { iid: 15, title: 'feat: merged three days ago', source_branch: 'merged-3d', web_url: url(15), draft: false, state: 'merged', merged_at: '2026-10-16T12:00:00Z', updated_at: '2026-10-16T12:00:00Z' },
  { iid: 16, title: 'Draft: wip parser', source_branch: 'wip-parser', web_url: url(16), draft: true, state: 'opened', merged_at: null, updated_at: '2026-10-19T10:00:00Z' },
  { iid: 17, title: 'fix(ci): cache keys', source_branch: 'ci-cache', web_url: url(17), draft: false, state: 'opened', merged_at: null, updated_at: '2026-10-19T11:45:00Z' },
  { iid: 18, title: 'old-style wip', source_branch: 'legacy-wip', web_url: url(18), work_in_progress: true, state: 'opened', merged_at: null, updated_at: '2026-10-18T12:00:00Z' },
  { iid: 10, title: 'an older merge', source_branch: 'old-merge', web_url: url(10), draft: false, state: 'merged', merged_at: '2026-10-09T12:00:00Z', updated_at: '2026-10-09T12:00:00Z' },
  { iid: 9, title: 'a closed MR', source_branch: 'closed', web_url: url(9), draft: false, state: 'closed', merged_at: null, updated_at: '2026-10-18T12:00:00Z' },
]

/** Display order: drafts newest first, then ready, then merged. */
export const ORDER = [16, 18, 17, 15]
