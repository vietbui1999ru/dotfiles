import type { EngineInterface } from 'claude-code'

import type { GitSnapshot, Usage } from '../types'
import { ctxTone, limitTone, PALETTE, type Tone } from './palette'

type Elements = ReturnType<EngineInterface['ui']['resolve']>
export type BandData = { dir: string; model: string; usage: Usage; git: GitSnapshot | null; style: string | null }

// Order matches the old status line: dir | git | ctx | 5h | 7d | [style] | (model)
export const drawBand = ({ Box, Text }: Elements, d: BandData) => {
  const tone = (t: Tone, text: string) => <Text color={PALETTE[t]}>{text}</Text>
  const pct = (label: string, v: number | undefined, toneOf: (n: number) => Tone) =>
    v === undefined ? null : <Text color={PALETTE[toneOf(v)]}> {label}:{v}%</Text>
  const g = d.git

  return (
    <Box>
      <Text>
        {tone('peach', d.dir)}
        {g && tone(g.isDirty ? 'yellow' : 'green', ` ${g.branch}${g.isDirty ? '*' : ''}`)}
        {g && !g.hasUpstream && tone('muted', ' local')}
        {g && g.ahead > 0 && tone('green', ` ahd:${g.ahead}`)}
        {g && g.behind > 0 && tone('yellow', ` bhd:${g.behind}`)}
        {g && g.stash > 0 && tone('peach', ` stsh:${g.stash}`)}
        {g?.worktree && tone('muted', ` [wt:${g.worktree}]`)}
        {pct('ctx', d.usage.ctx, ctxTone)}
        {pct('5h', d.usage.five, limitTone)}
        {pct('7d', d.usage.seven, limitTone)}
        {d.style && tone('muted', ` [${d.style}]`)}
        {tone('mauve', ` (${d.model})`)}
      </Text>
    </Box>
  )
}
