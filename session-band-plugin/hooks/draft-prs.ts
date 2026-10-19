// Pure logic for the draft PRs pane: read one `gh pr list` result, roll up its checks, pick and order the PRs,
// and draw the row strings. No engine here; draft-prs.tsx runs gh and maps these strings to Text.
import type { DraftPr, DraftPrsState, PrChecks, PrState } from '../types'

export const GH_ARGV = ['gh', 'pr', 'list', '--state', 'all', '--limit', '30', '--json', 'number,title,headRefName,url,isDraft,state,mergedAt,updatedAt,statusCheckRollup'] as const
export const GH_MISSING = 'gh did not run: not installed, or it timed out'
export const GH_AUTH = 'gh is not logged in: run gh auth login'
export const GH_NOT_REPO = 'not a GitHub repo: no GitHub remote here'
export const GH_UNREADABLE = 'gh printed something that is not a PR list'

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RUN_FAILED = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE']
const RANK: Record<PrState, number> = { draft: 0, ready: 1, merged: 2 }

type Check = { status?: unknown; conclusion?: unknown; state?: unknown }

/** A StatusContext has `state`; a CheckRun has `status` and `conclusion`. Failing beats pending beats passing. */
export const rollup = (items: unknown): PrChecks => {
  const checks = Array.isArray(items) ? items.filter((item): item is Check => !!item && typeof item === 'object') : []
  if (checks.length === 0) return 'none'
  const failed = (c: Check) => (typeof c.state === 'string' ? c.state === 'FAILURE' || c.state === 'ERROR' : RUN_FAILED.includes(String(c.conclusion)))
  const unfinished = (c: Check) => (typeof c.state === 'string' ? c.state === 'PENDING' || c.state === 'EXPECTED' : c.status !== 'COMPLETED')
  if (checks.some(failed)) return 'failing'
  return checks.some(unfinished) ? 'pending' : 'passing'
}

// Open PRs (draft or ready) and PRs merged in the last 7 days; closed and older merged PRs drop out.
const toPr = (raw: unknown, now: number): DraftPr | undefined => {
  if (!raw || typeof raw !== 'object') return undefined
  const p = raw as Record<string, unknown>
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  const mergedAt = Date.parse(text(p.mergedAt))
  let state: PrState
  if (p.state === 'OPEN') state = p.isDraft === true ? 'draft' : 'ready'
  else if (p.state === 'MERGED' && now - mergedAt <= WEEK_MS) state = 'merged'
  else return undefined
  const at = state === 'merged' ? mergedAt : Date.parse(text(p.updatedAt))
  return { number: Number(p.number), title: text(p.title), branch: text(p.headRefName), url: text(p.url), state, checks: rollup(p.statusCheckRollup), at: Number.isNaN(at) ? now : at }
}

/** Draft, then ready, then merged; newest first inside each group. */
export const pickPrs = (list: readonly unknown[], now: number): DraftPr[] =>
  list.flatMap(raw => toPr(raw, now) ?? []).sort((a, b) => RANK[a.state] - RANK[b.state] || b.at - a.at)

export type GhResult = { exitCode: number; stdout: string; stderr: string }

/** One gh run to the pane's PRs, or to the message it shows instead. `undefined` is a spawn failure or timeout. */
export const readGh = (r: GhResult | undefined, now: number): Pick<DraftPrsState, 'prs' | 'error'> => {
  if (!r) return { prs: [], error: GH_MISSING }
  if (r.exitCode === 4) return { prs: [], error: GH_AUTH }
  if (r.exitCode !== 0) {
    if (/known GitHub host|no git remotes|not a git repository/i.test(r.stderr)) return { prs: [], error: GH_NOT_REPO }
    return { prs: [], error: `gh failed (exit ${r.exitCode}): ${(r.stderr.trim().split('\n')[0] ?? '').slice(0, 80)}` }
  }
  let list: unknown
  try { list = JSON.parse(r.stdout) } catch { return { prs: [], error: GH_UNREADABLE } }
  return Array.isArray(list) ? { prs: pickPrs(list, now), error: undefined } : { prs: [], error: GH_UNREADABLE }
}

export const age = (ms: number): string => {
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m`
  return minutes < 1440 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`
}

const cut = (title: string, max: number) => (title.length > max ? `${title.slice(0, max - 1)}…` : title)

export const prLine = (pr: DraftPr, selected: boolean, now: number): string =>
  `${selected ? '›' : ' '}#${pr.number}  ${pr.state.padEnd(6)}  ${pr.checks.padEnd(7)}  ${cut(pr.title, 50)}  ${pr.branch}  ${age(now - pr.at)}`

export const summaryLine = (prs: readonly DraftPr[]): string => {
  const count = (state: PrState) => prs.filter(pr => pr.state === state).length
  return `${count('draft')} draft · ${count('ready')} ready · ${count('merged')} merged (7d)`
}
