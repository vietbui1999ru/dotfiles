// Pure logic for GitLab in the draft PRs pane: read one `glab mr list` result into the same DraftPr rows gh gives.
// No engine here; draft-prs.tsx runs glab through forge.ts.
import type { DraftPr, DraftPrsState, PrState } from '../types'
import { byGroup, WEEK_MS, type GhResult } from './draft-prs'

export const GLAB_ARGV = ['glab', 'mr', 'list', '--all', '--per-page', '30', '--output', 'json'] as const
export const GLAB_MISSING = 'glab did not run: not installed, or it timed out'
export const GLAB_AUTH = 'glab is not logged in: run glab auth login'
export const GLAB_UNREADABLE = 'glab printed something that is not an MR list'

// Opened MRs (draft or ready) and MRs merged in the last 7 days; closed, locked and older merged MRs drop out.
// The list endpoint carries no pipeline, so checks stay `none` rather than costing one call per MR.
const toMr = (raw: unknown, now: number): DraftPr | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const m = raw as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const mergedAt = Date.parse(text(m.merged_at))
  let state: PrState
  if (m.state === 'opened') state = m.draft === true || m.work_in_progress === true ? 'draft' : 'ready'
  else if (m.state === 'merged' && now - mergedAt <= WEEK_MS) state = 'merged'
  else return undefined
  const at = state === 'merged' ? mergedAt : Date.parse(text(m.updated_at))
  return { number: Number(m.iid), title: text(m.title), branch: text(m.source_branch), url: text(m.web_url), state, checks: 'none', at: Number.isNaN(at) ? now : at }
}

export const pickMrs = (list: readonly unknown[], now: number): DraftPr[] => list.flatMap(raw => toMr(raw, now) ?? []).sort(byGroup)

/** One glab run to the pane's MRs, or to the message it shows instead. glab has no auth exit code, so stderr decides. */
export const readGlab = (r: GhResult | undefined, now: number): Pick<DraftPrsState, 'prs' | 'error'> => {
  if (!r) return { prs: [], error: GLAB_MISSING }
  if (r.exitCode !== 0) {
    if (/401|unauthorized|auth login/i.test(r.stderr)) return { prs: [], error: GLAB_AUTH }
    return { prs: [], error: `glab failed (exit ${r.exitCode}): ${(r.stderr.trim().split('\n')[0] ?? '').slice(0, 80)}` }
  }
  let list: unknown
  try { list = JSON.parse(r.stdout) } catch { return { prs: [], error: GLAB_UNREADABLE } }
  return Array.isArray(list) ? { prs: pickMrs(list, now), error: undefined } : { prs: [], error: GLAB_UNREADABLE }
}
