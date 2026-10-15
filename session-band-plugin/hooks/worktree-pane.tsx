import type { EngineInterface } from 'claude-code'

import type { WorktreeRow, WorktreeState } from '../types'
import { PALETTE } from './palette'
import { countChanges, parseAheadBehind, parseHeartbeat, parseWorktrees, SYMBOL, type Worktree } from './worktrees'

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
  const rows: WorktreeRow[] = await Promise.all(trees.map(async tree => {
    const changes = countChanges((await git($, tree.path, ['status', '--porcelain'])) ?? '')
    const ab = await git($, tree.path, ['rev-list', '--left-right', '--count', '@{u}...HEAD'])
    const { ahead, behind } = ab ? parseAheadBehind(ab) : { ahead: 0, behind: 0 }
    const live = cwds.filter(dir => dir === tree.path || dir.startsWith(`${tree.path}/`)).length
    return { ...tree, changes, ahead, behind, live }
  }))
  const refs = (await git($, cwd, ['for-each-ref', '--format=%(refname:short)\t%(upstream:short)\t%(worktreepath)', 'refs/heads'])) ?? ''
  const branches = refs.split('\n').filter(Boolean).map(line => {
    const [name = '', upstream = '', worktree = ''] = line.split('\t')
    return { name, upstream: upstream || undefined, worktree: worktree || undefined }
  })
  return { rows, branches, at: await $.clock.now() }
}

const flags = (row: WorktreeRow) => [
  row.branch ? SYMBOL.branch : SYMBOL.detached,
  row.ahead > 0 ? `${SYMBOL.ahead}${row.ahead}` : '',
  row.behind > 0 ? `${SYMBOL.behind}${row.behind}` : '',
  row.changes > 0 ? `${SYMBOL.dirty}${row.changes}` : '',
  row.live > 0 ? `${SYMBOL.live}${row.live}` : '',
  row.prunable ? SYMBOL.prunable : '',
].filter(Boolean).join(' ')

// The pane body: worktrees first (flags, then name), the selected one's detail, then branches.
export const paneLines = (state: WorktreeState, selected: WorktreeRow | undefined): { text: string; color?: string }[] => {
  const lines: { text: string; color?: string }[] = []
  for (const row of state.data?.rows ?? []) {
    const mark = row.path === selected?.path ? '› ' : '  '
    lines.push({ text: `${mark}${flags(row)}  ${row.branch ?? row.head}  ${row.path}`, color: row.live > 0 ? PALETTE.green : undefined })
  }
  if (selected) lines.push({ text: `\n${selected.path}\n${SYMBOL.branch} ${selected.branch ?? `detached ${selected.head}`}  ${selected.ahead}${SYMBOL.ahead} ${selected.behind}${SYMBOL.behind}  ${selected.changes} changed  ${selected.live} live` })
  lines.push({ text: '\nbranches' })
  for (const branch of state.data?.branches ?? []) {
    lines.push({ text: `  ${SYMBOL.branch} ${branch.name}${branch.upstream ? `  -> ${branch.upstream}` : ''}${branch.worktree ? `  [${branch.worktree}]` : ''}`, color: branch.worktree ? PALETTE.muted : undefined })
  }
  return lines
}
