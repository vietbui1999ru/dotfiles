import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { worktreeRoot } from './review-batch'
import { readThread } from './review-thread'
import {
  buildTabs,
  describeDiff,
  fileDiff,
  floorFindings,
  hunkLine,
  hunkNewLines,
  lensDiagnostics,
  loadAgents,
  pageDiff,
  splitHunks,
  specShow,
  type DiffView,
  type Hunk,
  type ReviewPaneState,
  type ReviewTab,
} from './review-sources'
import { FOCUS_ACTION, FOCUS_REFUSED, JUMP_KEYS, MOD_PANES, PANE_TITLES, switchSteps } from './pane-nav'
import { PALETTE } from './palette'

// The atom lives here, not in review-sources: the engine's scan reads state only from
// an atom made in the module whose read/update call sites name it.
export const review = atom({ plugin: 'session-band', key: 'review' } as const, { tabs: [], hunk: 0 } as ReviewPaneState)

export type ReviewDraw = {
  tab: ReviewTab | undefined
  worktree: string
  diff: DiffView
  hunks: Hunk[]
  page: { text: string; paged: boolean; at: number; total: number }
  specShow: string
  check: string | undefined
  thread: Awaited<ReturnType<typeof readThread>>
  findings: string[]
  lens: string[]
}

const emptyDraw = (tab: ReviewTab | undefined): ReviewDraw => ({
  tab,
  worktree: '',
  diff: { kind: 'empty', text: '' },
  hunks: [],
  page: { text: '', paged: false, at: 0, total: 0 },
  specShow: '',
  check: undefined,
  thread: [],
  findings: [],
  lens: [],
})

const current = (state: ReviewPaneState): ReviewTab | undefined =>
  state.tabs.find(tab => tab.key === state.selected) ?? state.tabs[0]

/** Reads the selected tab as it now stands: diff or spec text, thread, findings. */
export async function draw($: EngineInterface, state: ReviewPaneState, worktree: string): Promise<ReviewDraw> {
  const tab = current(state)
  if (tab === undefined) return emptyDraw(undefined)
  const thread = await readThread($, worktree, tab.agent, tab.file)
  const findings = state.findings?.[tab.key] ?? []
  const lens = state.lens?.[tab.key] ?? []
  if (tab.kind === 'spec') {
    return {
      tab,
      worktree,
      diff: { kind: 'empty', text: '' },
      hunks: [],
      page: { text: '', paged: false, at: 0, total: 0 },
      specShow: await specShow($, worktree, tab.specPath ?? tab.file),
      check: state.checks?.[tab.specPath ?? tab.file],
      thread,
      findings,
      lens,
    }
  }
  const diff = describeDiff(tab.file, await fileDiff($, worktree, tab.base, tab.file))
  const hunks = splitHunks(diff.text).hunks
  return {
    tab,
    worktree,
    diff,
    hunks,
    page: pageDiff(diff.text, state.hunk),
    specShow: '',
    check: undefined,
    thread,
    findings,
    lens,
  }
}

/** Loads the tabs from disk and keeps the cursor, the unread flags and the findings. */
export async function reload($: EngineInterface, worktree?: string): Promise<ReviewPaneState> {
  const root = worktree ?? await worktreeRoot($, await $.session.cwd().catch(() => ''))
  const state = await read($, review)
  const agents = await loadAgents($, root)
  const tabs = buildTabs(agents).map(tab => ({ ...tab, ...(state.unread?.[tab.key] ? { unread: true } : {}) }))
  const focused = state.focus === undefined ? undefined : tabs.find(tab =>
    state.focus?.kind === 'pi' ? tab.runId === state.focus.runId
      : state.focus?.kind === 'spec' ? tab.specPath === state.focus.specPath
        : tab.agent === `claude:${state.focus?.specPath ?? ''}`)
  const selected = focused?.key ?? (tabs.some(tab => tab.key === state.selected) ? state.selected : tabs[0]?.key)
  const findings: Record<string, string[]> = {}
  const lens: Record<string, string[]> = {}
  for (const tab of tabs) {
    if (tab.kind !== 'spec') findings[tab.key] = await floorFindings($, root, tab.base, tab.file)
    lens[tab.key] = await lensDiagnostics($, root, tab.file)
  }
  const next: ReviewPaneState = {
    ...state,
    tabs,
    ...(selected === undefined ? { selected: undefined } : { selected }),
    focus: undefined,
    findings,
    lens,
    hunk: selected === state.selected ? state.hunk : 0,
  }
  await update($, review, () => next)
  return next
}

const selectTab = async ($: EngineInterface, state: ReviewPaneState, key: string | undefined) => {
  if (key === undefined) return
  await update($, review, value => ({
    ...value,
    selected: key,
    hunk: 0,
    composer: undefined,
    confirm: undefined,
    unread: { ...value.unread, [key]: false },
  }))
}

const moveTab = async ($: EngineInterface, state: ReviewPaneState, step: 1 | -1) => {
  if (state.tabs.length === 0) return
  const at = Math.max(0, state.tabs.findIndex(tab => tab.key === state.selected))
  const tab = state.tabs[(at + step + state.tabs.length) % state.tabs.length]
  await selectTab($, state, tab?.key)
}

const moveHunk = async ($: EngineInterface, state: ReviewPaneState, step: 1 | -1, total: number) => {
  if (total === 0) return
  const at = Math.min(Math.max(0, state.hunk), total - 1)
  await update($, review, value => ({ ...value, hunk: (at + step + total) % total }))
}

// `$` cannot cross an import, so this pane runs pane-nav's switch itself.
const goTo = async ($: EngineInterface, to: string | undefined) => {
  for (const step of switchSteps('review', to)) await ('close' in step ? $.ui.close({ id: step.close }) : $.ui.open({ id: step.open, title: step.title, focus: step.focus }))
}
// Review is not in MOD_PANES (its jump digits stay the five they are), so b/f cycles it
// after the five: the same order the other panes use, with this one appended.
const cycle = async ($: EngineInterface, step: 1 | -1) => {
  const listed = [...MOD_PANES, 'review']
  const open = (await $.ui.panes()).map(pane => pane.id).filter(id => listed.includes(id as (typeof listed)[number]))
  if (open.length === 0) return goTo($, undefined)
  const at = open.indexOf('review')
  await goTo($, open[(at + step + open.length) % open.length])
}

// Keep engine calls local: `$` cannot cross an import.
async function focusSelf($: EngineInterface) {
  if ((await $.prompt.read()).text.trim()) {
    await $.ui.toast(FOCUS_REFUSED)
    return
  }
  await $.ui.open({ id: 'review', title: PANE_TITLES.review, focus: true })
  if (!(await $.ui.panes()).some(pane => pane.id === 'review' && pane.isFocused)) await $.ui.toast(FOCUS_REFUSED)
}

export const register: Register = on => {
  on('command.run', { command: 'diff-review' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'review', title: PANE_TITLES.review, focus: true })
    return { text: 'Review opened.' }
  })
  on('ui.open', { id: 'review' }, async ($, e, next) => {
    const result = await next(e)
    await reload($)
    return result
  })
  on('ui.render', { component: 'Pane', requestId: 'review' }, async ($, e, _next) => {
    const { Box, Text, Button, Code, Input } = $.ui.resolve(e)
    const state = await read($, review)
    const worktree = await worktreeRoot($, await $.session.cwd().catch(() => ''))
    const tab = current(state)
    const view = await draw($, state, worktree)
    const composer = state.composer
    return <Box flexDirection="column">
      <Text weight="bold">Review</Text>
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="review-key-prev-tab" plain dimColor hotkey="h" label="prev file" onPress={() => void moveTab($, state, -1)} />
        <Button key="review-key-next-tab" plain dimColor hotkey="l" label="next file" onPress={() => void moveTab($, state, 1)} />
        <Button key="review-key-down" plain dimColor hotkey="j" label="next hunk" onPress={() => void moveHunk($, state, 1, view.page.total)} />
        <Button key="review-key-up" plain dimColor hotkey="k" label="prev hunk" onPress={() => void moveHunk($, state, -1, view.page.total)} />
        <Button key="review-key-prev" plain dimColor hotkey="b" label="prev" onPress={() => void cycle($, -1)} />
        <Button key="review-key-next" plain dimColor hotkey="f" label="next" onPress={() => void cycle($, 1)} />
        <Button key="review-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'review' })} />
        <Button key="review-key-focus" plain dimColor action={FOCUS_ACTION} label="ctrl+x b" onPress={() => void focusSelf($)} />
        {JUMP_KEYS.map(j => <Button key={`review-key-jump-${j.key}`} plain dimColor hotkey={j.key} label={j.label} onPress={() => void goTo($, j.id)} />)}
      </Box>
      {state.tabs.length === 0 && <Text dimColor>No unapproved files in this worktree.</Text>}
      {state.tabs.map(row => <Text key={`review-tab-${row.key}`} mono weight={row.key === tab?.key ? 'bold' : undefined} color={row.unread ? PALETTE.yellow : undefined}>
        {`${row.key === tab?.key ? '›' : ' '} ${row.label}  ${row.file}${row.shared ? `  shared: ${row.shared.join(', ')}` : ''}${row.unread ? '  unread' : ''}`}
      </Text>)}
      {tab !== undefined && <Text dimColor>{`${tab.label} · ${tab.file}${tab.shared ? ` · shared with ${tab.shared.join(', ')}` : ''}`}</Text>}
      {state.note !== undefined && <Text color={PALETTE.yellow}>{state.note}</Text>}
      {view.page.paged && <Text dimColor>{`hunk ${view.page.at + 1}/${view.page.total}`}</Text>}
      {tab?.kind === 'spec' && <Box flexDirection="column" marginTop={1}>
        <Text dimColor>{`spec ${tab.specPath ?? tab.file}`}</Text>
        {view.specShow.split('\n').map((line, index) => <Text key={`review-spec-${index}`} mono>{line}</Text>)}
        {view.check !== undefined && <Box flexDirection="column" marginTop={1}>
          <Text dimColor>last check</Text>
          {view.check.split('\n').map((line, index) => <Text key={`review-check-${index}`} mono>{line}</Text>)}
        </Box>}
      </Box>}
      {tab !== undefined && tab.kind !== 'spec' && <Box flexDirection="column" marginTop={1}>
        {view.diff.kind === 'binary' || view.diff.kind === 'deleted'
          ? <Text color={PALETTE.yellow}>{view.diff.summary}</Text>
          : view.diff.kind === 'empty'
            ? <Text dimColor>{`no changes against ${tab.base}`}</Text>
            : <Code format="diff" source={view.page.text} path={tab.file} />}
      </Box>}
      {(view.findings.length > 0 || view.lens.length > 0) && <Box flexDirection="column" marginTop={1}>
        {view.findings.map((line, index) => <Text key={`review-floor-${index}`} color={PALETTE.orange}>{line}</Text>)}
        {view.lens.map((line, index) => <Text key={`review-lens-${index}`} dimColor>{line}</Text>)}
      </Box>}
      {composer !== undefined && composer.tab === tab?.key && <Input
        key={composer.kind === 'comment' ? 'review-comment' : 'review-patch'}
        label={composer.kind === 'comment' ? 'Comment' : 'Proposed patch'}
        placeholder={composer.kind === 'comment' ? 'comment on this hunk' : 'edit the new lines'}
        value={composer.text}
        submitLabel="add"
        autoFocus
        onSubmit={value => void addEntry($, tab, composer.kind, value, view)}
      />}
    </Box>
  })
}

// Filled by the later tasks; keeping the signature here lets the render compile first.
async function addEntry($: EngineInterface, tab: ReviewTab | undefined, kind: 'comment' | 'patch', text: string, view: ReviewDraw): Promise<void> {
  if (tab === undefined) return
  await update($, review, state => ({ ...state, composer: { tab: tab.key, kind, text: '' } }))
  void text
  void view
}
