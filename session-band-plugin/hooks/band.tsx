import type { EngineInterface } from 'claude-code'

import type { GitSnapshot, Usage } from '../types'
import type { HandoffSegment } from './handoff'
import { layoutBand, SEP, type Seg } from './band-text'
import { PALETTE, type Tone } from './palette'

type Elements = ReturnType<EngineInterface['ui']['resolve']>
export type BandData = { dir: string; model: string; usage: Usage; git: GitSnapshot | null; style: string | null; handoff?: HandoffSegment; width?: number; onPi?: () => void; onWorktrees?: () => void; onPiHistory?: () => void; openAlerts?: number }

const handoffTone = (state: HandoffSegment['state'] | undefined, review: HandoffSegment['review']): Tone => {
  if (review === 'pending' || review === 'decided, waiting for the next Pi run in this repo' || state === 'Queued' || state === 'Paused') return 'yellow'
  if (state === 'Failed' || state === 'Killed') return 'red'
  if (state === 'Done') return 'green'
  return 'teal'
}

// Left: the worktrees (⎇) and Pi history (⟲) icon chips, then where · budget · alerts · who. Right: the Pi hand-off icon (π), coloured by state. The strings come from band-text.ts.
export const drawBand = ({ Box, Text, Button }: Elements, d: BandData) => {
  const lay = layoutBand({ ...d, wt: !!d.onWorktrees, history: !!d.onPiHistory, piChip: !!d.onPi })
  const run = (seg: Seg, key: string) => <Text key={key} color={PALETTE[seg.tone]}>{seg.text}</Text>
  const status = lay.status.flatMap((group, gi) => [
    ...(gi > 0 ? [<Text key={`sep-${gi}`} color={PALETTE.muted}>{SEP}</Text>] : []),
    ...group.flatMap((seg, si) => (si > 0 ? [' ', run(seg, `seg-${gi}-${si}`)] : [run(seg, `seg-${gi}-${si}`)])),
  ])
  const piColor = d.handoff ? PALETTE[handoffTone(d.handoff.state, d.handoff.review)] : PALETTE.muted

  return (
    <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
      {/* Buttons sit beside the Text, never inside it: the engine refuses a Button inside an inline element. */}
      <Box flexDirection="row" columnGap={1} flexShrink={1}>
        {lay.wt && <Button key="wt-open" plain dimColor label={lay.wt} onPress={() => d.onWorktrees?.()} />}
        {lay.history && <Button key="hist-open" plain dimColor label={lay.history} onPress={() => d.onPiHistory?.()} />}
        <Text mono wrap="truncate-end">{status}</Text>
      </Box>
      {lay.pi && (d.onPi
        ? <Button key="pi-open" plain onPress={() => d.onPi?.()}><Text mono color={piColor}>{lay.pi}</Text></Button>
        : <Text mono color={piColor}>{lay.pi}</Text>)}
    </Box>
  )
}
