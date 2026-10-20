import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { DraftPrsState } from '../types'
import { CHECK_MARK, groups, prLine } from './draft-prs'
import { forgeById, forgeFor, hostOf, NO_REMOTE, noForge, REMOTE_ARGV } from './forge'
import { FOCUS_ACTION, FOCUS_REFUSED, JUMP_KEYS, nextPane, PANE_TITLES, switchSteps } from './pane-nav'

const view = atom({ plugin: 'session-band', key: 'draftPrs' } as const, { loading: false } as DraftPrsState)

// Read-only: the origin remote picks the forge, then that forge's list command is the only other call.
// A spawn failure or timeout resolves undefined, which the forge's reader names.
const refresh = async ($: EngineInterface) => {
  await update($, view, state => ({ ...state, loading: true }))
  const cwd = await $.session.cwd()
  const remote = await $.process.run(REMOTE_ARGV, { cwd, timeoutMs: 15_000 }).catch(() => undefined)
  const host = remote?.exitCode === 0 ? hostOf(remote.stdout) : undefined
  const forge = host === undefined ? undefined : forgeFor(host)
  if (!forge) {
    const error = host === undefined ? NO_REMOTE : noForge(host)
    await update($, view, state => ({ ...state, loading: false, prs: [], error, forge: undefined }))
    return
  }
  const r = await $.process.run(forge.argv, { cwd, timeoutMs: 15_000 }).catch(() => undefined)
  const now = await $.clock.now()
  await update($, view, state => ({ ...state, loading: false, ...forge.read(r, now), forge: forge.id }))
}

// j/k move through the rows in display order; wraps at both ends, as the worktrees pane does.
const move = async ($: EngineInterface, step: 1 | -1) => {
  const state = await read($, view)
  const ids = (state.prs ?? []).map(pr => pr.number)
  if (ids.length === 0) return
  const at = Math.max(state.selected === undefined ? 0 : ids.indexOf(state.selected), 0)
  await update($, view, value => ({ ...value, selected: ids[(at + step + ids.length) % ids.length] }))
}

// `$` cannot cross an import, so this pane runs pane-nav's switch itself.
const goTo = async ($: EngineInterface, to: string | undefined) => {
  for (const s of switchSteps('draft-prs', to)) await ('close' in s ? $.ui.close({ id: s.close }) : $.ui.open({ id: s.open, title: s.title, focus: s.focus }))
}
const cycle = async ($: EngineInterface, step: 1 | -1) => goTo($, nextPane((await $.ui.panes()).map(pane => pane.id), 'draft-prs', step))

// Keep engine calls local: `$` cannot cross an import.
async function focusSelf($: EngineInterface) {
  if ((await $.prompt.read()).text.trim()) {
    await $.ui.toast(FOCUS_REFUSED)
    return
  }
  await $.ui.open({ id: 'draft-prs', title: PANE_TITLES['draft-prs'], focus: true })
  if (!(await $.ui.panes()).some(pane => pane.id === 'draft-prs' && pane.isFocused)) await $.ui.toast(FOCUS_REFUSED)
}

export const register: Register = on => {
  on('command.run', { command: 'draft-prs' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'draft-prs', title: 'Draft PRs', focus: true })
    return { text: 'Draft PRs opened.' }
  })

  // No timer: the list loads when the pane opens and on r.
  on('ui.open', { id: 'draft-prs' }, async ($, e, next) => {
    const result = await next(e)
    await refresh($)
    return result
  })
  on('ui.render', { component: 'Pane', requestId: 'draft-prs' }, async ($, e, _next) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const state = await read($, view)
    const now = await $.clock.now()
    const prs = state.prs ?? []
    const pick = prs.find(pr => pr.number === state.selected) ?? prs[0]
    const sigil = forgeById(state.forge)?.sigil
    const note = state.error ?? (state.loading ? 'Loading…' : prs.length === 0 ? `No open or recently merged ${state.forge === 'gitlab' ? 'MRs' : 'PRs'}.` : undefined)
    return <Box flexDirection="column">
      <Text weight="bold">Draft PRs</Text>
      {/* Hotkeys, not hints: a key the pane does not bind falls through to the composer. */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="pr-key-down" plain dimColor hotkey="j" label="down" onPress={() => void move($, 1)} />
        <Button key="pr-key-up" plain dimColor hotkey="k" label="up" onPress={() => void move($, -1)} />
        <Button key="pr-key-reload" plain dimColor hotkey="r" label="reload" onPress={() => void refresh($)} />
        <Button key="pr-key-copy" plain dimColor hotkey="y" label="copy" onPress={press => { if (pick) void $.ui.copy({ text: pick.url, surface: press.surface }) }} />
        <Button key="pr-key-prev" plain dimColor hotkey="b" label="prev" onPress={() => void cycle($, -1)} />
        <Button key="pr-key-next" plain dimColor hotkey="f" label="next" onPress={() => void cycle($, 1)} />
        <Button key="pr-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'draft-prs' })} />
        <Button key="pr-key-focus" plain dimColor action={FOCUS_ACTION} label="ctrl+x b" onPress={() => void focusSelf($)} />
        {JUMP_KEYS.map(j => <Button key={`pr-key-jump-${j.key}`} plain dimColor hotkey={j.key} label={j.label} onPress={() => void (j.id === 'draft-prs' ? undefined : goTo($, j.id))} />)}
      </Box>
      {note !== undefined && <Text dimColor>{note}</Text>}
      {/* A header per state separates drafts from the rest; the row keeps only what tells PRs apart. */}
      {groups(prs).map(group => <Box key={`pr-group-${group.header}`} flexDirection="column" marginBottom={1}>
        <Text weight="bold">{group.header}</Text>
        {group.prs.map(pr => <Box key={`pr-row-${pr.number}`} flexDirection="row" columnGap={1}>
          <Text mono>{pr === pick ? '›' : ' '}</Text>
          <Text mono color={CHECK_MARK[pr.checks].color} dimColor={!CHECK_MARK[pr.checks].color}>{CHECK_MARK[pr.checks].glyph}</Text>
          <Text mono weight={pr === pick ? 'bold' : undefined} dimColor={pr.state === 'merged' && pr !== pick}>{prLine(pr, now, sigil)}</Text>
        </Box>)}
      </Box>)}
      {pick && <Text mono dimColor>{pick.branch} · <Link href={pick.url} label={pick.url} /></Text>}
    </Box>
  })
}
