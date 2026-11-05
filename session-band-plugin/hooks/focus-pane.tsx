import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { FOCUS_ARGV, parseFocus, type FocusState } from './focus'
import { ACTIONS, keyOf, pick, pipeline, rowId, rows, slotLine, step } from './focus-pane-logic'

type FocusPaneState = { loading: boolean; state?: FocusState; selected?: string; error?: string }

const view = atom({ plugin: 'session-band', key: 'focusPane' } as const, { loading: false } as FocusPaneState)

// Read-only: the pane only reads the board through the script. A spawn failure or a non-board reply
// becomes a message in the pane, never a throw.
const refresh = async ($: EngineInterface) => {
  await update($, view, state => ({ ...state, loading: true }))
  const home = (await $.env.get('HOME')) ?? ''
  const cwd = await $.session.cwd()
  const r = await $.process.run(FOCUS_ARGV(home, cwd), { cwd, timeoutMs: 15_000 }).catch(() => undefined)
  const parsed = r?.exitCode === 0 ? parseFocus(r.stdout) : undefined
  await update($, view, state => ({ ...state, loading: false, state: parsed, error: parsed ? undefined : noBoardOrFailed(r) }))
}

// A script that ran but printed no board is "no board"; one that failed to run is a failure. Never a throw.
const noBoardOrFailed = (r: { exitCode: number } | undefined) => (r?.exitCode === 0 ? 'No focus board. Create ~/repos/Obsidian/Focus.md.' : 'The focus script did not run.')

// o opens the board in Obsidian. The path is the default board; FOCUS_BOARD overrides it for tests.
const openBoard = async ($: EngineInterface) => {
  const home = (await $.env.get('HOME')) ?? ''
  const board = (await $.env.get('FOCUS_BOARD')) ?? `${home}/repos/Obsidian/Focus.md`
  await $.process.run(ACTIONS.open(board), { timeoutMs: 15_000 }).catch(() => undefined)
}

// Each action runs the script and then re-reads the board, so the pane shows what changed.
const act = async ($: EngineInterface, argv: string[], message: string) => {
  const cwd = await $.session.cwd()
  const r = await $.process.run(argv, { cwd, timeoutMs: 15_000 }).catch(() => undefined)
  await $.ui.toast(r?.exitCode === 0 ? message : `focus failed: ${(r?.stderr ?? '').trim().split('\n')[0] || 'no output'}`)
  await refresh($)
}

// The key the selected row acts on. Undefined when there is no row or the row has no key (a free-text parked line).
const selectedKey = async ($: EngineInterface): Promise<string | undefined> => {
  const state = await read($, view)
  return keyOf(pick(state.state ? rows(state.state) : [], state.selected))
}

// Act on the selected row's key, if it has one; the home path comes from the engine env.
const onSelected = async ($: EngineInterface, argv: (home: string, key: string) => string[], message: (key: string) => string) => {
  const key = await selectedKey($)
  if (key === undefined) return
  await act($, argv((await $.env.get('HOME')) ?? '', key), message(key))
}

const move = async ($: EngineInterface, by: 1 | -1) => {
  const state = await read($, view)
  const all = state.state ? rows(state.state) : []
  const next = step(all, state.selected, by)
  if (next !== undefined) await update($, view, value => ({ ...value, selected: next }))
}

export const register: Register = on => {
  on('command.run', { command: 'focus' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'focus', title: 'Focus', focus: true })
    return { text: 'Focus opened.' }
  })

  // No timer: the board is read when the pane opens and on r.
  on('ui.open', { id: 'focus' }, async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })

  on('ui.render', { component: 'Pane', requestId: 'focus' }, async ($, e, _next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, view)
    const focus = state.state
    const all = focus ? rows(focus) : []
    const pickRow = pick(all, state.selected)
    const note = state.error ?? (state.loading ? 'Loading…' : undefined)
    return <Box flexDirection="column">
      <Text weight="bold">Focus</Text>
      {/* Hotkeys, not hints: a key the pane does not bind falls through to the composer. */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="focus-key-down" plain dimColor hotkey="j" label="down" onPress={() => void move($, 1)} />
        <Button key="focus-key-up" plain dimColor hotkey="k" label="up" onPress={() => void move($, -1)} />
        <Button key="focus-key-open" plain dimColor hotkey="o" label="open board" onPress={() => void openBoard($)} />
        <Button key="focus-key-switch" plain dimColor hotkey="s" label="switch" onPress={() => void onSelected($, ACTIONS.switch, key => `switched to ${key}`)} />
        <Button key="focus-key-park" plain dimColor hotkey="p" label="park" onPress={() => void onSelected($, ACTIONS.park, key => `parked ${key}`)} />
        <Button key="focus-key-drop" plain dimColor hotkey="d" label="drop" onPress={() => void onSelected($, ACTIONS.drop, key => `dropped ${key}`)} />
        <Button key="focus-key-reload" plain dimColor hotkey="r" label="reload" onPress={() => void refresh($)} />
        <Button key="focus-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'focus' })} />
      </Box>
      {note !== undefined && <Text dimColor>{note}</Text>}
      {focus && <Box flexDirection="column" marginBottom={1}>
        <Text mono>{slotLine('H', focus.hobby)}</Text>
        <Text mono>{slotLine('W', focus.work)}</Text>
        {focus.breaches && focus.breaches.length > 0 && <Text mono color="red">{focus.breaches.join(' · ')}</Text>}
      </Box>}
      {focus && <Box flexDirection="column" marginBottom={1}>
        <Text weight="bold">Frozen ({focus.frozen.length})</Text>
        {focus.frozen.length === 0 && <Text dimColor>none</Text>}
        {all.filter(row => row.kind === 'frozen').map(row => <Box key={`focus-frozen-${rowId(row)}`} flexDirection="row" columnGap={1}>
          <Text mono>{row === pickRow ? '›' : ' '}</Text>
          <Text mono weight={row === pickRow ? 'bold' : undefined}>{row.kind === 'frozen' ? `${row.key}  ${pipeline(row.stage)}` : ''}</Text>
        </Box>)}
      </Box>}
      {focus && <Box flexDirection="column">
        <Text weight="bold">Parked ({focus.parked.length})</Text>
        {focus.parked.length === 0 && <Text dimColor>none</Text>}
        {all.filter(row => row.kind === 'parked').map(row => <Box key={`focus-parked-${rowId(row)}`} flexDirection="row" columnGap={1}>
          <Text mono>{row === pickRow ? '›' : ' '}</Text>
          <Text mono weight={row === pickRow ? 'bold' : undefined}>{row.kind === 'parked' ? row.text : ''}</Text>
        </Box>)}
      </Box>}
    </Box>
  })
}
