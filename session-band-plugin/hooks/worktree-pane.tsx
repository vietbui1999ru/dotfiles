import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { WorktreeBranch, WorktreeRow, WorktreeState } from '../types'
import { nextPane } from './pane-nav'
import { countChanges, liveByTree, paneLines, parseAheadBehind, parseHeartbeat, parseWorktrees, treeKeys, type Worktree } from './worktrees'

const view = atom({ plugin: 'session-band', key: 'worktrees' } as const, { open: false, legend: true } as WorktreeState)

const FRESH_MS = 60_000

// Read-only git: a failing call (no upstream, not a repo) yields undefined rather than an error.
const git = async ($: EngineInterface, cwd: string, args: string[]): Promise<string | undefined> => {
  const r = await $.process.run(['git', '-C', cwd, '--no-optional-locks', ...args]).catch(() => undefined)
  return r && r.exitCode === 0 ? r.stdout : undefined
}

// A session's heartbeat names its cwd; a worktree has a live session when a fresh cwd sits inside its path.
const liveCwds = async ($: EngineInterface): Promise<string[]> => {
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const entries = await $.fs.list(tmp).catch(() => [])
  const now = await $.clock.now()
  const beats = entries.filter(entry => entry.kind === 'file' && entry.name.startsWith('session-band-') && entry.name.endsWith('.alive') && now - entry.mtimeMs < FRESH_MS)
  const bodies = await Promise.all(beats.map(entry => $.fs.read(`${tmp}/${entry.name}`).catch(() => '')))
  return bodies.flatMap(body => { const beat = parseHeartbeat(typeof body === 'string' ? body : ''); return beat ? [beat.cwd] : [] })
}

export const gather = async ($: EngineInterface, cwd: string): Promise<WorktreeState['data']> => {
  const trees: Worktree[] = parseWorktrees((await git($, cwd, ['worktree', 'list', '--porcelain'])) ?? '')
  const cwds = await liveCwds($)
  const liveByPath = liveByTree(cwds, trees.map(tree => tree.path))
  const rows: WorktreeRow[] = await Promise.all(trees.map(async tree => {
    const changes = countChanges((await git($, tree.path, ['status', '--porcelain'])) ?? '')
    const ab = await git($, tree.path, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    const { ahead, behind } = ab ? parseAheadBehind(ab) : { ahead: 0, behind: 0 }
    const live = liveByPath.get(tree.path) ?? 0
    return { ...tree, changes, ahead, behind, live }
  }))
  const refs = (await git($, cwd, ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(worktreepath)', 'refs/heads'])) ?? ''
  // A branch with no worktree has no row, so its ahead and behind come from its own upstream here.
  const branches: WorktreeBranch[] = await Promise.all(refs.split('\n').filter(Boolean).map(async line => {
    const [name = '', upstream = '', worktree = ''] = line.split('\t')
    const branch: WorktreeBranch = { name, upstream: upstream || undefined, worktree: worktree || undefined }
    if (branch.worktree || !branch.upstream) return branch
    const ab = await git($, cwd, ['rev-list', '--left-right', '--count', `${name}@{u}...${name}`])
    return { ...branch, ...(ab ? parseAheadBehind(ab) : {}) }
  }))
  return { rows, branches, at: await $.clock.now() }
}

const refresh = async ($: EngineInterface) => {
  const data = await gather($, await $.session.cwd())
  await update($, view, state => ({ ...state, data }))
}

// j/k move through the root and the tree items in display order; wraps at both ends.
const move = async ($: EngineInterface, step: 1 | -1) => {
  const state = await read($, view)
  const keys = treeKeys(state.data?.rows ?? [], state.data?.branches ?? [])
  if (keys.length === 0) return
  const at = Math.max(keys.indexOf(state.selected ?? keys[0]), 0)
  await update($, view, value => ({ ...value, selected: keys[(at + step + keys.length) % keys.length] }))
}

export const register: Register = on => {
  on('command.run', { command: 'worktrees' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'worktrees', title: 'Worktrees', focus: true })
    return { text: 'Worktrees opened.' }
  })

  on('ui.open', { id: 'worktrees' }, async ($, e, next) => {
    const result = await next(e)
    await update($, view, state => ({ ...state, open: true }))
    await refresh($)
    return result
  })

  on('ui.close', { id: 'worktrees' }, async ($, e, next) => {
    const result = await next(e)
    if (!('deny' in result)) await update($, view, state => ({ ...state, open: false }))
    return result
  })

  on('ui.render', { component: 'Pane', requestId: 'worktrees' }, async ($, e, _next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const state = await read($, view)
    const rows = state.data?.rows ?? []
    const branches = state.data?.branches ?? []
    const selectedKey = state.selected ?? treeKeys(rows, branches)[0]
    const lines = paneLines(rows, branches, state.legend, selectedKey)
    return <Box flexDirection="column">
      <Text weight="bold">Worktrees</Text>
      {/* Hotkeys, not hints: a key the pane does not bind falls through to the composer. */}
      <Box flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}>
        <Button key="wt-key-down" plain dimColor hotkey="j" label="down" onPress={() => void move($, 1)} />
        <Button key="wt-key-up" plain dimColor hotkey="k" label="up" onPress={() => void move($, -1)} />
        <Button key="wt-key-legend" plain dimColor hotkey="h" label="legend" onPress={() => void update($, view, value => ({ ...value, legend: !value.legend }))} />
        <Button key="wt-key-refresh" plain dimColor hotkey="r" label="refresh" onPress={() => void refresh($)} />
        <Button key="wt-key-prev" plain dimColor hotkey="b" label="prev pane" onPress={() => void $.ui.panes().then(panes => { const to = nextPane(panes.map(pane => pane.id), 'worktrees', -1); if (to && to !== 'worktrees') void $.ui.open({ id: to, focus: true }) })} />
        <Button key="wt-key-next" plain dimColor hotkey="f" label="next pane" onPress={() => void $.ui.panes().then(panes => { const to = nextPane(panes.map(pane => pane.id), 'worktrees', 1); if (to && to !== 'worktrees') void $.ui.open({ id: to, focus: true }) })} />
        <Button key="wt-key-quit" plain dimColor hotkey="q" label="close" onPress={() => void $.ui.close({ id: 'worktrees' })} />
      </Box>
      {lines.map((line, index) => <Text key={`wt-line-${index}`} mono color={line.color} weight={line.strong ? 'bold' : undefined}>{line.text}</Text>)}
    </Box>
  })
}
