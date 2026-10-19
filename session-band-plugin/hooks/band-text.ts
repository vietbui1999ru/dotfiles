// Pure layout of the band's text: which runs show, in what order, and what a narrow band drops first.
// No engine here, so band.test.ts pins the exact strings; band.tsx only maps the runs to Text.
import type { GitSnapshot, Usage } from '../types'
import type { HandoffSegment } from './handoff'
import { ctxBar } from './format'
import { ctxTone, limitTone, type Tone } from './palette'
import { SYMBOL } from './worktrees'

/** One coloured run. `drop` ranks what a narrow band gives up, 1 first; a run without it always stays. */
export type Seg = { text: string; tone: Tone; drop?: number }

/** Between groups. Runs inside a group are joined by one space. */
export const SEP = ' · '

export type StatusInput = { dir: string; model: string; usage: Usage; git: GitSnapshot | null; style: string | null; openAlerts?: number; sendIt?: boolean }

/** Left to right: where (dir, branch, sync), budget (ctx, 5h, 7d), alerts, who (model, style). */
export const statusGroups = (d: StatusInput): Seg[][] => {
  const g = d.git
  const where: Seg[] = [{ text: d.dir, tone: 'peach' }]
  if (g) {
    where.push({ text: `${g.branch}${g.isDirty ? '*' : ''}`, tone: g.isDirty ? 'yellow' : 'green' })
    if (!g.hasUpstream) where.push({ text: 'local', tone: 'muted', drop: 3 })
    if (g.ahead > 0) where.push({ text: `${SYMBOL.ahead}${g.ahead}`, tone: 'green' })
    if (g.behind > 0) where.push({ text: `${SYMBOL.behind}${g.behind}`, tone: 'yellow' })
    if (g.stash > 0) where.push({ text: `${SYMBOL.stash}${g.stash}`, tone: 'peach', drop: 4 })
  }
  const u = d.usage
  const budget: Seg[] = []
  if (u.ctx !== undefined) budget.push({ text: ctxBar(u.ctx), tone: ctxTone(u.ctx) })
  if (u.five !== undefined) budget.push({ text: `5h:${u.five}%`, tone: limitTone(u.five) })
  if (u.seven !== undefined) budget.push({ text: `7d:${u.seven}%`, tone: limitTone(u.seven) })
  const alerts: Seg[] = d.openAlerts ? [{ text: `⚠${d.openAlerts}`, tone: 'red' }] : []
  // No drop rank: fitStatus never removes it, so the send-it state stays visible at any width.
  if (d.sendIt) alerts.push({ text: '⇉ send-it', tone: 'red' })
  const who: Seg[] = [{ text: d.model, tone: 'mauve' }]
  if (d.style) who.push({ text: d.style, tone: 'muted', drop: 1 })
  return [where, budget, alerts, who].filter(group => group.length > 0)
}

export const statusText = (groups: readonly Seg[][]): string =>
  groups.map(group => group.map(seg => seg.text).join(' ')).join(SEP)

/** Drops runs by rank until the line fits `width`; anything still too wide the Text truncates at its end. */
export const fitStatus = (groups: Seg[][], width: number): Seg[][] => {
  let kept = groups
  for (const rank of [1, 3, 4]) {
    if (statusText(kept).length <= width) break
    kept = kept.map(group => group.filter(seg => seg.drop !== rank)).filter(group => group.length > 0)
  }
  return kept
}

/** Keep the identity, model and outcome first when a narrow terminal needs truncation. */
export const handoffText = (handoff: HandoffSegment, width?: number): string => {
  if (handoff.kind === 'rollup') return handoff.text
  const required = [`pi#${handoff.id}${handoff.glyph ?? ''}`, [handoff.model, handoff.effort].filter(Boolean).join(':') || undefined, handoff.review, handoff.exit === undefined ? undefined : `exit ${handoff.exit}`].filter(Boolean)
  const optional = [handoff.elapsed, handoff.tokens && `${handoff.tokens} tok`, handoff.cost, handoff.files ? `${handoff.files} files` : undefined, handoff.label].filter(Boolean)
  const full = [...required.slice(0, 2), ...optional, ...required.slice(2)].join(' ')
  if (width === undefined || full.length <= width) return full
  const withoutLabelFilesTokensCost = [...required.slice(0, 2), handoff.elapsed, ...required.slice(2)].filter(Boolean).join(' ')
  if (withoutLabelFilesTokensCost.length <= width) return withoutLabelFilesTokensCost
  return [...required.slice(0, 2), ...required.slice(2)].filter(Boolean).join(' ')
}

// The terminal draws a Button as `[ label ]`: four cells of chrome, then one cell of gap to its neighbour.
const CHIP = 5

/** The left icon chips: worktrees, then Pi history. Each glyph is one cell. */
export const PI_HISTORY = 'π'

export type BandInput = StatusInput & { handoff?: HandoffSegment; width?: number; wt: boolean; history: boolean }
export type BandLayout = { wt?: string; history?: string; status: Seg[][]; pi?: string }

/** The icon chips take their cells first, then the status line less the Pi chip's shortest form; the Pi chip gets what is left. */
export const layoutBand = (d: BandInput): BandLayout => {
  const wt = d.wt ? SYMBOL.branch : undefined
  const history = d.history ? PI_HISTORY : undefined
  const groups = statusGroups(d)
  if (d.width === undefined) return { wt, history, status: groups, pi: d.handoff && handoffText(d.handoff) }
  const navCells = [wt, history].reduce((n, chip) => n + (chip ? chip.length + CHIP : 0), 0)
  const piFloor = d.handoff ? handoffText(d.handoff, 0).length + CHIP : 0
  const status = fitStatus(groups, d.width - navCells - piFloor)
  const pi = d.handoff && handoffText(d.handoff, d.width - navCells - statusText(status).length - CHIP)
  return { wt, history, status, pi }
}
