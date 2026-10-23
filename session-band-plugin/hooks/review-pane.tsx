import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { batchFiles, enqueue, markBatch, readQueue, worktreeRoot, type Batch } from './review-batch'
import { sweep as sweepDelivery } from './review-deliver'
import { appendEntry, readThread, type ThreadEntry } from './review-thread'
import {
  buildTabs,
  describeDiff,
  editPatch,
  fileDiff,
  floorFindings,
  hunkLine,
  hunkNewLines,
  lensDiagnostics,
  loadAgents,
  pageDiff,
  splitHunks,
  specShow,
  tabKey,
  type DiffView,
  type Hunk,
  type ReviewPaneState,
  type ReviewTab,
} from './review-sources'
import { FOCUS_ACTION, FOCUS_REFUSED, JUMP_KEYS, MOD_PANES, PANE_TITLES, switchSteps } from './pane-nav'
import { landPatch } from './review-land'
import { acRunArgv } from './gates'
import { approveArgv, approvalAction } from './pane.tsx'
import { approveSession } from './review-touch'
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

export type ThreadLine = { key: string; text: string; color?: string; state?: string; batch?: string }

export const BATCH_TEXT: Record<Batch['state'], string> = { queued: 'queued', delivered: 'delivered', answered: 'answered', 'no-reply': 'no reply' }

/** The batch a person entry was sent in, if any: its latest state is what the entry shows. */
const batchFor = (entry: ThreadEntry, queue: readonly Batch[]): Batch | undefined =>
  queue.find(batch => batch.entryIds.includes(entry.id))

/** The file's thread in order; a clapback shows in its own colour with the reason it gave. */
export const threadLines = (entries: readonly ThreadEntry[], queue: readonly Batch[] = []): ThreadLine[] =>
  entries.map(entry => {
    const who = entry.author === 'person' ? 'you' : entry.author === 'agent' ? 'agent' : 'pane'
    const where = entry.line === undefined ? '' : ` L${entry.line}`
    const key = `review-thread-${entry.id}`
    const batch = batchFor(entry, queue)
    const state = batch === undefined ? undefined : BATCH_TEXT[batch.state]
    const known = batch === undefined ? {} : { ...(state === undefined ? {} : { state }), batch: batch.id }
    if (entry.kind === 'clapback') return { key, text: `${who}${where} · clapback: ${entry.text}`, color: PALETTE.red, ...known }
    if (entry.kind === 'patch') return { key, text: `${who}${where} · proposed patch: ${entry.text}`, color: PALETTE.yellow, ...known }
    return { key, text: `${who}${where} · ${entry.kind}: ${entry.text}`, ...known }
  })

/**
 * The answerer cycler: the default is the agent that wrote the change, because its model's cached
 * context keeps a reply cheap. Any other choice re-reads that context uncached, hence the warning.
 */
export const ANSWER_WARNING = 'switching model re-reads the full context (no cache)'

export const ANSWERERS: readonly { label: string; model?: string; effort?: string }[] = [
  { label: 'same as agent' },
  { label: 'haiku · low', model: 'haiku', effort: 'low' },
  { label: 'sonnet · medium', model: 'sonnet', effort: 'medium' },
  { label: 'opus · high', model: 'opus', effort: 'high' },
  { label: 'opencode-go/claude-haiku-5-5 · off', model: 'opencode-go/claude-haiku-5-5:off', effort: 'off' },
  { label: 'opencode-go/deepseek-v4.1-flash · medium', model: 'opencode-go/deepseek-v4.1-flash:medium', effort: 'medium' },
  { label: 'opencode-go/deepseek-v4.1-flash · off', model: 'opencode-go/deepseek-v4.1-flash:off', effort: 'off' },
]

export const answererIndex = (state: { answerer?: Record<string, number> }, agent: string): number =>
  (state.answerer?.[agent] ?? 0) % ANSWERERS.length

const cycleAnswerer = async ($: EngineInterface, tab: ReviewTab | undefined) => {
  if (tab === undefined) return
  await update($, review, state => ({ ...state, answerer: { ...state.answerer, [tab.agent]: (answererIndex(state, tab.agent) + 1) % ANSWERERS.length } }))
}

/** Every unsent person entry for one agent, across its files; sender and agent replies are not sent. */
async function unsentFor($: EngineInterface, worktree: string, state: ReviewPaneState, agent: string): Promise<ThreadEntry[]> {
  const queue = await readQueue($, worktree)
  const batched = new Set(queue.flatMap(batch => batch.entryIds))
  const files = [...new Set(state.tabs.filter(tab => tab.agent === agent).map(tab => tab.file))]
  const entries: ThreadEntry[] = []
  for (const file of files) {
    for (const entry of await readThread($, worktree, agent, file)) {
      if (entry.author === 'person' && (entry.kind === 'comment' || entry.kind === 'patch') && !batched.has(entry.id)) entries.push(entry)
    }
  }
  return entries
}

/** `s`: one batch per agent, with the cycler's model and effort on it, then the delivery sweep. */
async function send($: EngineInterface, state: ReviewPaneState, tab: ReviewTab | undefined, worktree: string): Promise<void> {
  if (tab === undefined) return
  const entries = await unsentFor($, worktree, state, tab.agent)
  if (entries.length === 0) {
    await $.ui.toast('Nothing unsent for this agent.')
    return
  }
  const batch = await enqueue($, worktree, tab.agent, entries)
  const choice = ANSWERERS[answererIndex(state, tab.agent)]
  if (choice?.model !== undefined) await markBatch($, worktree, batch.id, 'queued', { model: choice.model, ...(choice.effort === undefined ? {} : { effort: choice.effort }) })
  await sweepDelivery($, worktree, await $.clock.now())
  await $.ui.toast(`Queued ${entries.length} ${entries.length === 1 ? 'entry' : 'entries'} for ${tab.label}.`)
}

/** A `no reply` batch goes back to `queued`, with any earlier reason dropped, and is swept again. */
async function resend($: EngineInterface, worktree: string, id: string): Promise<void> {
  await markBatch($, worktree, id, 'queued', { reason: undefined })
  await sweepDelivery($, worktree, await $.clock.now())
}

const landed = (entries: readonly ThreadEntry[]): Set<string> =>
  new Set(entries.flatMap(entry => entry.kind === 'system' && entry.replyTo !== undefined ? [entry.replyTo] : []))

/** The latest agent reply for each proposed patch, the one whose verdict decides what happens. */
const verdicts = (entries: readonly ThreadEntry[]): Map<string, ThreadEntry> => {
  const latest = new Map<string, ThreadEntry>()
  for (const entry of entries) {
    if ((entry.kind === 'reply' || entry.kind === 'clapback') && entry.replyTo !== undefined) latest.set(entry.replyTo, entry)
  }
  return latest
}

/**
 * An `agree` reply lands its patch mechanically, once: a landed or refused patch has a system
 * entry naming it, so a redraw or a retry never lands it twice. A busy agent waits for the tick.
 */
export async function landAgreed($: EngineInterface, worktree: string, state: ReviewPaneState): Promise<void> {
  for (const tab of state.tabs) {
    if (tab.kind === 'spec') continue
    const entries = await readThread($, worktree, tab.agent, tab.file)
    const patches = new Map(entries.filter(entry => entry.kind === 'patch').map(entry => [entry.id, entry]))
    const done = landed(entries)
    for (const [id, reply] of verdicts(entries)) {
      if (reply.verdict !== 'agree' || done.has(id)) continue
      const patch = patches.get(id)
      if (patch === undefined) continue
      const result = await landPatch($, worktree, patch)
      if (result === 'landed') await $.ui.toast(`review: landed the agreed patch in ${tab.file}`)
      if (result === 'waiting') await $.ui.toast(`review: ${tab.label} is mid-turn; the patch waits.`)
    }
  }
}

/** `o`: the person's patch lands anyway, and the commit says the agent warned against it. */
async function overrule($: EngineInterface, worktree: string, tab: ReviewTab | undefined, thread: readonly ThreadEntry[]): Promise<void> {
  if (tab === undefined) return
  const patches = new Map(thread.filter(entry => entry.kind === 'patch').map(entry => [entry.id, entry]))
  const clapback = [...verdicts(thread).values()].reverse().find(entry => entry.verdict === 'clapback' && patches.has(entry.replyTo ?? ''))
  if (clapback === undefined) {
    await $.ui.toast('No clapback to overrule in this file.')
    return
  }
  const result = await landPatch($, worktree, patches.get(clapback.replyTo as string) as ThreadEntry, clapback)
  await $.ui.toast(result === 'landed' ? 'review: overruled and landed.' : result === 'waiting' ? 'review: the agent is mid-turn; the overrule waits.' : 'review: the patch no longer applies.')
}

/** `y`: the agent's alternative patch lands as agreed instead of the person's. */
async function acceptAlternative($: EngineInterface, worktree: string, tab: ReviewTab | undefined, thread: readonly ThreadEntry[]): Promise<void> {
  if (tab === undefined) return
  const clapback = [...verdicts(thread).values()].reverse().find(entry => entry.verdict === 'clapback' && typeof entry.patch === 'string' && entry.patch.trim() !== '')
  if (clapback === undefined) {
    await $.ui.toast('No alternative patch to accept in this file.')
    return
  }
  const alternative: ThreadEntry = { ...clapback, kind: 'patch', author: 'person', patch: clapback.patch as string }
  const result = await landPatch($, worktree, alternative)
  await $.ui.toast(result === 'landed' ? "review: landed the agent's alternative." : result === 'waiting' ? 'review: the agent is mid-turn; the alternative waits.' : 'review: the alternative no longer applies.')
}

/**
 * The answered batches the pane has not shown yet: each raises a toast naming its files and marks
 * their tabs unread. The selected tab counts as viewed; moving to another clears its mark.
 */
export async function noteAnswers($: EngineInterface, state: ReviewPaneState, worktree: string, queue: readonly Batch[]): Promise<ReviewPaneState> {
  const seen = new Set(state.notified ?? [])
  const fresh = queue.filter(batch => batch.state === 'answered' && !seen.has(batch.id))
  if (fresh.length === 0) return state
  const unread = { ...state.unread }
  for (const batch of fresh) {
    const files = await batchFiles($, worktree, batch)
    for (const file of files) {
      const key = tabKey(batch.agent, file)
      if (key !== state.selected) unread[key] = true
    }
    if (files.length > 0) await $.ui.toast(`review answer for ${files.join(', ')}`)
  }
  const next: ReviewPaneState = { ...state, notified: [...seen, ...fresh.map(batch => batch.id)], unread }
  await update($, review, () => next)
  return next
}

const openComposer = async ($: EngineInterface, tab: ReviewTab | undefined, kind: 'comment' | 'patch', hunk: Hunk | undefined) => {
  if (tab === undefined) return
  if (kind === 'patch' && hunk === undefined) {
    await $.ui.toast('This file has no hunk to edit.')
    return
  }
  await update($, review, state => ({
    ...state,
    composer: { tab: tab.key, kind, text: kind === 'patch' && hunk !== undefined ? hunkNewLines(hunk).join('\n') : '' },
  }))
}

const sessionOf = (tab: ReviewTab): string => tab.agent.slice('claude:'.length)

/**
 * Landing first, then approval: an agreed patch the agent has not yet seen applied would make the
 * run's snapshot stale. A busy agent holds the approval too, like a note.
 */
async function landAgentAgreed($: EngineInterface, worktree: string, state: ReviewPaneState, agent: string): Promise<boolean> {
  for (const tab of state.tabs.filter(row => row.agent === agent && row.kind !== 'spec')) {
    const entries = await readThread($, worktree, tab.agent, tab.file)
    const patches = new Map(entries.filter(entry => entry.kind === 'patch').map(entry => [entry.id, entry]))
    const done = landed(entries)
    for (const [id, reply] of verdicts(entries)) {
      if (reply.verdict !== 'agree' || done.has(id)) continue
      const patch = patches.get(id)
      if (patch === undefined) continue
      if (await landPatch($, worktree, patch) === 'waiting') return false
    }
  }
  return true
}

const setNote = async ($: EngineInterface, note: string) => update($, review, state => ({ ...state, note }))

/** `a`: the agent's own gate, never a decision the pane writes itself. */
async function approveCurrent($: EngineInterface, worktree: string, state: ReviewPaneState, tab: ReviewTab | undefined): Promise<void> {
  if (tab === undefined) return
  const home = await $.env.get('HOME')
  if (tab.kind === 'claude') {
    if (state.confirm !== tab.agent) {
      await update($, review, value => ({ ...value, confirm: tab.agent, note: `Press a again to approve ${tab.label}.` }))
      await $.ui.toast(`Press a again to approve ${tab.label}.`)
      return
    }
    await approveSession($, sessionOf(tab))
    await update($, review, value => ({ ...value, confirm: undefined, note: undefined }))
    await $.ui.toast(`${tab.label} approved.`)
    await reload($, worktree)
    return
  }
  if (!home) {
    await $.ui.toast('Review gate not available.')
    return
  }
  if (tab.kind === 'spec') {
    const result = await $.process.run(acRunArgv(home, 'approve', tab.specPath ?? tab.file), { cwd: worktree, timeoutMs: 600_000 }).catch(() => undefined)
    const message = (result?.stdout.trim() || result?.stderr.trim() || 'not approved').split('\n').filter(Boolean).pop() ?? 'not approved'
    await $.ui.toast(message)
    await reload($, worktree)
    return
  }
  if (tab.runId === undefined) return
  if (!(await landAgentAgreed($, worktree, state, tab.agent))) {
    await $.ui.toast('The agent is mid-turn; the patch must land before approval.')
    return
  }
  const result = await $.process.run(approveArgv(home, tab.runId), { cwd: worktree, timeoutMs: 60_000 }).catch(() => undefined)
  const action = result ? approvalAction(result.stdout) : 'unavailable'
  if (action === 'approved') {
    await $.ui.toast('Review approved.')
    await reload($, worktree)
    return
  }
  if (action === 'open-review') {
    await setNote($, 'tree-changed: wait for the re-snapshot; this run is not approved.')
    await $.ui.toast('tree-changed: wait for the re-snapshot; this run is not approved.')
    return
  }
  let message: string | undefined
  try { message = (JSON.parse(result?.stdout ?? '') as { message?: string }).message } catch { /* the outcome was already parsed */ }
  await $.ui.toast(message ?? 'Review approval refused.')
}

/** `x`, twice: the explicit approve-for-all for a file two agents touched. */
async function approveForAll($: EngineInterface, worktree: string, state: ReviewPaneState, tab: ReviewTab | undefined): Promise<void> {
  if (tab === undefined) return
  const key = `all:${tab.file}`
  if (state.confirm !== key) {
    await update($, review, value => ({ ...value, confirm: key }))
    await $.ui.toast(`Press x again to approve ${tab.file} for every agent.`)
    return
  }
  const home = await $.env.get('HOME')
  await update($, review, value => ({ ...value, confirm: undefined }))
  for (const row of state.tabs.filter(item => item.file === tab.file)) {
    if (row.kind === 'claude') await approveSession($, sessionOf(row))
    if (row.kind === 'pi' && home && row.runId !== undefined && await landAgentAgreed($, worktree, state, row.agent)) {
      await $.process.run(approveArgv(home, row.runId), { cwd: worktree, timeoutMs: 60_000 }).catch(() => undefined)
    }
    if (row.kind === 'spec' && home) {
      await $.process.run(acRunArgv(home, 'approve', row.specPath ?? row.file), { cwd: worktree, timeoutMs: 600_000 }).catch(() => undefined)
    }
  }
  await $.ui.toast(`Approved ${tab.file} for every agent.`)
  await reload($, worktree)
}

/**
 * `r`: the file is not accepted. A Claude session keeps it in `touched` and gets a queued note
 * saying why; a Pi run records the return in the pane only, never as a notes or patch decision.
 */
async function returnFile($: EngineInterface, worktree: string, tab: ReviewTab | undefined): Promise<void> {
  if (tab === undefined) return
  if (tab.kind === 'spec') {
    await $.ui.toast('A spec is approved or rejected in the gates pane.')
    return
  }
  if (tab.kind === 'claude') {
    const entry: ThreadEntry = {
      id: crypto.randomUUID(),
      at: new Date(await $.clock.now()).toISOString(),
      agent: tab.agent,
      file: tab.file,
      kind: 'comment',
      author: 'person',
      text: `Returned for rework: ${tab.file}`,
    }
    await appendEntry($, worktree, entry)
    await enqueue($, worktree, tab.agent, [entry])
    await sweepDelivery($, worktree, await $.clock.now())
    await setNote($, `returned ${tab.file}: it stays unapproved; a note is queued.`)
    await $.ui.toast(`Returned ${tab.file}: it stays unapproved; a note is queued.`)
    return
  }
  await appendEntry($, worktree, {
    id: crypto.randomUUID(),
    at: new Date(await $.clock.now()).toISOString(),
    agent: tab.agent,
    file: tab.file,
    kind: 'system',
    author: 'pane',
    text: 'returned for rework',
  })
  await update($, review, value => ({
    ...value,
    returned: { ...value.returned, [tab.agent]: [...(value.returned?.[tab.agent] ?? []), tab.file] },
    note: `returned ${tab.file}: the run is not approved; resolve it in the review.`,
  }))
  await $.ui.toast(`Returned ${tab.file}: the run is not approved; resolve it in the review.`)
}

let watching = false

/**
 * Outside `ui.render`, where writing state is refused: answers are noticed when the pane opens and
 * on a slow tick while it stays open, so a reply arriving mid-review marks its tab.
 */
function startAnswerWatch($: EngineInterface): void {
  if (watching) return
  watching = true
  $.clock.every(15_000, () => {
    void (async () => {
      const worktree = await worktreeRoot($, await $.session.cwd().catch(() => ''))
      const queue = await readQueue($, worktree)
      const state = await read($, review)
      await noteAnswers($, state, worktree, queue)
      await landAgreed($, worktree, await read($, review))
    })().catch(() => undefined)
  })
}

export const register: Register = on => {
  on('command.run', { command: 'diff-review' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'review', title: PANE_TITLES.review, focus: true })
    return { text: 'Review opened.' }
  })
  on('ui.open', { id: 'review' }, async ($, e, next) => {
    const result = await next(e)
    const state = await reload($)
    const worktree = await worktreeRoot($, await $.session.cwd().catch(() => ''))
    await noteAnswers($, state, worktree, await readQueue($, worktree))
    await landAgreed($, worktree, await read($, review))
    startAnswerWatch($)
    return result
  })
  on('ui.render', { component: 'Pane', requestId: 'review' }, async ($, e, _next) => {
    const { Box, Text, Button, Code, Input } = $.ui.resolve(e)
    const worktree = await worktreeRoot($, await $.session.cwd().catch(() => ''))
    const queue = await readQueue($, worktree)
    const state = await read($, review)
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
        <Button key="review-key-comment" plain dimColor={tab === undefined || tab.kind === 'spec'} hotkey="c" label="comment" onPress={() => void openComposer($, tab, 'comment', view.hunks[view.page.at])} />
        <Button key="review-key-patch" plain dimColor={tab === undefined || tab.kind === 'spec' || view.page.total === 0} hotkey="p" label="propose edit" onPress={() => void openComposer($, tab, 'patch', view.hunks[view.page.at])} />
        <Button key="review-send" plain dimColor={tab === undefined} hotkey="s" label="send" onPress={() => void send($, state, tab, worktree)} />
        <Button key="review-key-model" plain dimColor={tab === undefined} hotkey="m" label="answerer" onPress={() => void cycleAnswerer($, tab)} />
        <Button key="review-overrule" plain dimColor={tab === undefined || !view.thread.some(entry => entry.kind === 'clapback')} hotkey="o" label="overrule" onPress={() => void overrule($, worktree, tab, view.thread)} />
        <Button key="review-accept-alternative" plain dimColor={tab === undefined || !view.thread.some(entry => entry.kind === 'clapback' && entry.patch !== undefined)} hotkey="y" label="accept alternative" onPress={() => void acceptAlternative($, worktree, tab, view.thread)} />
        <Button key="review-approve" plain dimColor={tab === undefined} hotkey="a" label="approve" onPress={() => void approveCurrent($, worktree, state, tab)} />
        <Button key="review-approve-all" plain dimColor={tab === undefined || (tab.shared === undefined && state.tabs.filter(item => item.file === tab.file).length < 2)} hotkey="x" label="approve for all" onPress={() => void approveForAll($, worktree, state, tab)} />
        <Button key="review-return" plain dimColor={tab === undefined || tab.kind === 'spec'} hotkey="r" label="return" onPress={() => void returnFile($, worktree, tab)} />
        <Button key="review-key-prev" plain dimColor hotkey="b" label="prev" onPress={() => void cycle($, -1)} />
        <Button key="review-key-next" plain dimColor hotkey="f" label="next" onPress={() => void cycle($, 1)} />
        <Button key="review-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'review' })} />
        <Button key="review-key-focus" plain dimColor action={FOCUS_ACTION} label="ctrl+x b" onPress={() => void focusSelf($)} />
        {JUMP_KEYS.map(j => <Button key={`review-key-jump-${j.key}`} plain dimColor hotkey={j.key} label={j.label} onPress={() => void goTo($, j.id)} />)}
      </Box>
      {state.tabs.length === 0 && <Text dimColor>No unapproved files in this worktree.</Text>}
      {state.tabs.map(row => {
        const unread = row.unread === true || state.unread?.[row.key] === true
        return <Text key={`review-tab-${row.key}`} mono weight={row.key === tab?.key ? 'bold' : undefined} color={unread ? PALETTE.yellow : undefined}>
          {`${row.key === tab?.key ? '›' : ' '} ${row.label}  ${row.file}${row.shared ? `  shared: ${row.shared.join(', ')}` : ''}${unread ? '  unread' : ''}`}
        </Text>
      })}
      {tab !== undefined && <Text dimColor>{`${tab.label} · ${tab.file}${tab.shared ? ` · shared with ${tab.shared.join(', ')}` : ''}`}</Text>}
      {tab !== undefined && <Text dimColor>{`answerer: ${ANSWERERS[answererIndex(state, tab.agent)]?.label ?? 'same as agent'}`}</Text>}
      {tab !== undefined && answererIndex(state, tab.agent) > 0 && <Text color={PALETTE.yellow}>{ANSWER_WARNING}</Text>}
      {tab !== undefined && state.confirm === tab.agent && <Text color={PALETTE.yellow}>{`Press a again to approve ${tab.label}.`}</Text>}
      {tab !== undefined && state.confirm === `all:${tab.file}` && <Text color={PALETTE.yellow}>{`Press x again to approve ${tab.file} for every agent.`}</Text>}
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
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>thread</Text>
        {threadLines(view.thread, queue).map(line => <Box key={line.key} flexDirection="row" columnGap={1}>
          <Text color={line.color}>{line.text}</Text>
          {line.state !== undefined && <Text dimColor>{`[${line.state}]`}</Text>}
          {line.state === 'no reply' && line.batch !== undefined && <Button key={`review-resend-${line.batch}`} plain label="resend" onPress={() => void resend($, worktree, line.batch as string)} />}
        </Box>)}
      </Box>
      {composer !== undefined && composer.tab === tab?.key && <Input
        key={composer.kind === 'comment' ? 'review-comment' : 'review-patch'}
        label={composer.kind === 'comment' ? 'Comment' : 'Proposed patch'}
        placeholder={composer.kind === 'comment' ? 'comment on this hunk' : 'edit the new lines'}
        value={composer.text}
        submitLabel="add"
        autoFocus
        onSubmit={value => void addEntry($, tab, composer.kind, value, view.hunks[view.page.at], worktree)}
      />}
    </Box>
  })
}

/**
 * Appends the person's comment or proposed patch to the file's thread, durably and before it is
 * shown: `s` is what sends it. A patch is the unified diff from the hunk's old side to the typed text.
 */
async function addEntry($: EngineInterface, tab: ReviewTab | undefined, kind: 'comment' | 'patch', text: string, hunk: Hunk | undefined, worktree: string): Promise<void> {
  if (tab === undefined) return
  if (kind === 'patch' && hunk === undefined) {
    await update($, review, state => ({ ...state, composer: undefined }))
    await $.ui.toast('This file has no hunk to edit.')
    return
  }
  const entry: ThreadEntry = {
    id: crypto.randomUUID(),
    at: new Date(await $.clock.now()).toISOString(),
    agent: tab.agent,
    file: tab.file,
    kind,
    author: 'person',
    text: kind === 'patch' ? text.split('\n')[0] ?? '' : text,
    ...(kind === 'comment' && hunk !== undefined && hunkLine(hunk) !== undefined ? { line: hunkLine(hunk) as number } : {}),
    ...(kind === 'patch' && hunk !== undefined ? { patch: editPatch(tab.file, hunk, text) } : {}),
  }
  await appendEntry($, worktree, entry)
  await update($, review, state => ({ ...state, composer: undefined }))
  await $.ui.toast(kind === 'comment' ? 'Comment added. Press s to send.' : 'Proposed patch added. Press s to send.')
}
