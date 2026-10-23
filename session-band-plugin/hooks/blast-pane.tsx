import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { PALETTE } from './palette'
import type { PreviewFacts, PreviewTarget } from './preview'

// A read-only companion to the blast-radius question: the full preview, highlighted
// and scrollable. The question dialog stays the gate; this pane never answers it.
export const BLAST_PANE = { id: 'blast', title: 'Blast radius' } as const
const facts = atom({ plugin: 'session-band', key: 'blastFacts' } as const, null as PreviewFacts | null)

const bytes = (value: number) =>
  value < 1024 ? `${value} B` : value < 1024 * 1024 ? `${Math.round(value / 1024)} KiB` : `${(value / (1024 * 1024)).toFixed(1)} MiB`

export const targetTone = (target: PreviewTarget): string =>
  target.tracked === true ? PALETTE.green : target.tracked === false ? PALETTE.yellow : PALETTE.muted

// git clean -n says "Would remove", rsync -n says "deleting": the lines that destroy.
export const dryRunTone = (line: string): string | undefined =>
  /^(Would remove|deleting) /.test(line) ? PALETTE.red : undefined

// Opening or closing the pane must never decide the question, so both swallow errors.
// Function declarations: `$` may cross an import only into one.
export async function showBlast($: EngineInterface, value: PreviewFacts) {
  await update($, facts, () => value)
  await $.ui.open({ id: BLAST_PANE.id, title: BLAST_PANE.title }).catch(() => undefined)
}
export async function hideBlast($: EngineInterface) {
  await $.ui.close({ id: BLAST_PANE.id }).catch(() => undefined)
  await update($, facts, () => null)
}

export const register: Register = on => {
  on('ui.render', { component: 'Pane', requestId: BLAST_PANE.id }, async ($, e, _next) => {
    const { Box, Text, Code } = $.ui.resolve(e)
    const f = await read($, facts)
    if (!f) return <Text dimColor>No blast-radius question is open.</Text>
    const targets = f.targets ?? []
    const total = f.totalBytes === undefined ? '' : `, ${bytes(f.totalBytes)} total`
    return <Box flexDirection="column">
      <Text weight="bold" color={PALETTE.orange}>{`Why: ${f.reason}`}</Text>
      <Code language="bash" source={f.command} />
      <Text weight="bold">{`Targets: ${targets.length}${total}`}</Text>
      {targets.map((t, i) => <Text key={`blast-target-${i}`} mono color={targetTone(t)}>
        {`  ${t.path}${t.bytes === undefined ? '' : ` (${bytes(t.bytes)})`}${t.tracked === undefined ? '' : t.tracked ? '  tracked' : '  untracked'}`}
      </Text>)}
      {(f.unexpandedGlobs ?? []).map((g, i) => <Text key={`blast-glob-${i}`} mono color={PALETTE.red}>{`  glob not expanded: ${g}`}</Text>)}
      {f.dryRun && <Text weight="bold">{`Dry run (${f.dryRun.label})`}</Text>}
      {f.dryRun?.output.split('\n').filter(Boolean).map((line, i) => <Text key={`blast-dry-${i}`} mono color={dryRunTone(line)}>{`  ${line}`}</Text>)}
    </Box>
  })
}
