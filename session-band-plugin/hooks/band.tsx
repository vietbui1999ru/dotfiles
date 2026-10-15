import type { EngineInterface } from 'claude-code'

import type { GitSnapshot, Usage } from '../types'
import type { HandoffSegment } from './handoff'
import { ctxBar, ctxLeft } from './format'
import { ctxTone, limitTone, PALETTE, type Tone } from './palette'

type Elements = ReturnType<EngineInterface['ui']['resolve']>
export type BandData = { dir: string; model: string; usage: Usage; git: GitSnapshot | null; style: string | null; handoff?: HandoffSegment; width?: number; onPi?: () => void; onWorktrees?: () => void }

const handoffTone = (state: HandoffSegment['state'] | undefined, review: HandoffSegment['review']): Tone => {
  if (review === 'pending' || review === 'decided, waiting for the next Pi run in this repo' || state === 'Queued' || state === 'Paused') return 'yellow'
  if (state === 'Failed' || state === 'Killed') return 'red'
  if (state === 'Done') return 'green'
  return 'teal'
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

// Order matches the old status line: dir | git | ctx | 5h | 7d | [style] | (model) | pi
export const drawBand = ({ Box, Text, Button }: Elements, d: BandData) => {
  const tone = (t: Tone, text: string) => <Text color={PALETTE[t]}>{text}</Text>
  const pct = (label: string, v: number | undefined, toneOf: (n: number) => Tone) =>
    v === undefined ? null : <Text color={PALETTE[toneOf(v)]}> {label}:{v}%</Text>
  const g = d.git

  return (
    <Box>
      {/* Buttons sit beside the Text, never inside it: the engine refuses a Button inside an inline element. */}
      {d.onWorktrees && <Button key="wt-open" onPress={() => d.onWorktrees?.()}>{g?.worktree ? `[wt:${g.worktree}] ` : '[wt] '}</Button>}
      <Text>
        {tone('peach', d.dir)}
        {g && tone(g.isDirty ? 'yellow' : 'green', ` ${g.branch}${g.isDirty ? '*' : ''}`)}
        {g && !g.hasUpstream && tone('muted', ' local')}
        {g && g.ahead > 0 && tone('green', ` ahd:${g.ahead}`)}
        {g && g.behind > 0 && tone('yellow', ` bhd:${g.behind}`)}
        {g && g.stash > 0 && tone('peach', ` stsh:${g.stash}`)}
        {d.usage.ctx !== undefined && tone(ctxTone(d.usage.ctx), ` ${ctxBar(d.usage.ctx)}`)}
        {d.usage.ctx !== undefined && tone('muted', ` ${ctxLeft(d.usage.ctx)}% left`)}
        {pct('5h', d.usage.five, limitTone)}
        {pct('7d', d.usage.seven, limitTone)}
        {d.style && tone('muted', ` [${d.style}]`)}
        {tone('mauve', ` (${d.model})`)}
      </Text>
      {d.handoff && d.onPi && <Button key="pi-open" onPress={() => d.onPi?.()}>[pi]</Button>}
      {d.handoff && tone(handoffTone(d.handoff.state, d.handoff.review), ` ${handoffText(d.handoff, d.width)}`)}
    </Box>
  )
}
