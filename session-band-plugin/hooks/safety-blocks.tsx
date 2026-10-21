import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { SafetyBlocksState } from '../types'
import { loadSessionBlocks, safetyBlockLine, safetyLogArgv, type SafetyVerdict } from './safety-blocks'

export const PANE = { id: 'safety-blocks', title: 'Blocks', command: 'blocks' } as const
const view = atom({ plugin: 'session-band', key: 'safetyBlocks' } as const, { loading: false, rows: [] } as SafetyBlocksState)

// No timer: the list loads when the pane opens, on r, and after each verdict.
const refresh = async ($: EngineInterface) => {
  await update($, view, state => ({ ...state, loading: true }))
  const rows = await loadSessionBlocks($).catch(() => [])
  await update($, view, state => ({
    ...state,
    loading: false,
    rows,
    selected: rows.some(row => row.id === state.selected) ? state.selected : rows[0]?.id,
  }))
}

// j/k move through the rows in display order; wraps at both ends, as the other panes do.
const move = async ($: EngineInterface, step: 1 | -1) => {
  const state = await read($, view)
  const ids = state.rows.map(row => row.id)
  if (ids.length === 0) return
  const at = Math.max(state.selected === undefined ? 0 : ids.indexOf(state.selected), 0)
  await update($, view, value => ({ ...value, selected: ids[(at + step + ids.length) % ids.length] }))
}

// A verdict only records the human's judgement; the CLI writes it and nothing here can allow a block.
const mark = async ($: EngineInterface, verdict: SafetyVerdict) => {
  const state = await read($, view)
  const row = state.rows.find(value => value.id === state.selected)
  const home = await $.env.get('HOME').catch(() => undefined)
  if (!row || !home) {
    await $.ui.toast('No block selected.')
    return
  }
  const result = await $.process.run(safetyLogArgv(home, row.id, verdict), { timeoutMs: 10_000 }).catch(() => undefined)
  await $.ui.toast(result?.exitCode === 0 ? `Marked ${row.id} ${verdict}.` : (result?.stderr.trim() || 'safety-log mark failed.'))
  await refresh($)
}

export const register: Register = on => {
  on('command.run', { command: PANE.command }, async ($, _e, _next) => {
    await $.ui.open({ id: PANE.id, title: PANE.title, focus: true })
    return { text: 'Blocks opened.' }
  })

  on('ui.open', { id: PANE.id }, async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })
  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e, _next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, view)
    const rows = state.rows
    const pick = rows.find(row => row.id === state.selected) ?? rows[0]
    const note = state.loading ? 'Loading…' : rows.length === 0 ? 'No blocked commands in this session.' : undefined
    return <Box flexDirection="column">
      <Text weight="bold">{PANE.title}</Text>
      {/* Hotkeys, not hints: a key the pane does not bind falls through to the composer. */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="sb-key-down" plain dimColor hotkey="j" label="down" onPress={() => void move($, 1)} />
        <Button key="sb-key-up" plain dimColor hotkey="k" label="up" onPress={() => void move($, -1)} />
        <Button key="sb-key-ok" plain dimColor hotkey="o" label="ok" onPress={() => void mark($, 'ok')} />
        <Button key="sb-key-false-positive" plain dimColor hotkey="f" label="false-positive" onPress={() => void mark($, 'false-positive')} />
        <Button key="sb-key-reload" plain dimColor hotkey="r" label="reload" onPress={() => void refresh($)} />
        <Button key="sb-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: PANE.id })} />
      </Box>
      {note !== undefined && <Text dimColor>{note}</Text>}
      {rows.map(row => <Box key={`sb-row-${row.id}`} flexDirection="row" columnGap={1}>
        <Text mono>{row.id === pick?.id ? '›' : ' '}</Text>
        <Text mono weight={row.id === pick?.id ? 'bold' : undefined} dimColor={row.verdict !== undefined}>{safetyBlockLine(row)}</Text>
      </Box>)}
      {pick && <Text mono dimColor>{`${pick.cwd} · ${pick.transcript}`}</Text>}
    </Box>
  })
}
