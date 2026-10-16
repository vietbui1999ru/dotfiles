// Parsers for the git output the worktrees pane reads. The process calls stay in register code (the engine
// does not let `$` cross an import); this file only turns their text into rows.
import type { WorktreeBranch, WorktreeRow } from '../types'
import { PALETTE } from './palette'

export const SYMBOL = { branch: '⎇', ahead: '↑', behind: '↓', dirty: '✎', live: '●', detached: '⊘', prunable: '⚠' } as const

export type Worktree = { path: string; head: string; branch?: string; detached: boolean; prunable: boolean }

// `git worktree list --porcelain`: blocks separated by a blank line, one attribute per line.
export const parseWorktrees = (porcelain: string): Worktree[] =>
  porcelain.split('\n\n').filter(Boolean).flatMap(block => {
    const lines = block.split('\n')
    const path = lines.find(line => line.startsWith('worktree '))?.slice('worktree '.length)
    if (!path) return []
    const branchRef = lines.find(line => line.startsWith('branch '))?.slice('branch '.length)
    return [{
      path,
      head: (lines.find(line => line.startsWith('HEAD '))?.slice(5) ?? '').slice(0, 7),
      branch: branchRef?.replace(/^refs\/heads\//, ''),
      detached: lines.includes('detached'),
      prunable: lines.some(line => line.startsWith('prunable')),
    }]
  })

// `git rev-list --left-right --count @{u}...HEAD` prints "<behind>\t<ahead>".
export const parseAheadBehind = (text: string): { ahead: number; behind: number } => {
  const [behind = 0, ahead = 0] = text.trim().split(/\s+/).map(Number)
  return { ahead, behind }
}

// `git status --porcelain`: one line per changed path; any line means dirty.
export const countChanges = (porcelain: string): number => porcelain.split('\n').filter(Boolean).length

// Heartbeat body written by the mod: "<unix seconds>\t<session cwd>".
export const parseHeartbeat = (body: string): { atSec: number; cwd: string } | undefined => {
  const [sec, ...rest] = body.trim().split('\t')
  const atSec = Number(sec)
  return Number.isFinite(atSec) && rest.length > 0 ? { atSec, cwd: rest.join('\t') } : undefined
}

// ---- Tree view: pure, so the layout and triage order are tested without the engine ----

export type Flags = { changes: number; ahead: number; behind: number; live: number; prunable?: boolean }
export type TreeItem = { key: string; label: string; flags: Flags; path?: string; action: boolean }
export type TreeLine = { key?: string; text: string; color?: string }

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

// Triage: anything that wants a decision sorts above quiet branches.
export const needsAction = (f: Flags): boolean => f.changes > 0 || f.ahead > 0 || f.behind > 0 || f.live > 0 || !!f.prunable

export const flagText = (f: Flags): string => [
  f.ahead > 0 ? `${SYMBOL.ahead}${f.ahead}` : '',
  f.behind > 0 ? `${SYMBOL.behind}${f.behind}` : '',
  f.changes > 0 ? `${SYMBOL.dirty}${f.changes}` : '',
  f.live > 0 ? `${SYMBOL.live}${f.live}` : '',
  f.prunable ? SYMBOL.prunable : '',
].filter(Boolean).join(' ')

const withFlags = (text: string, f: Flags): string => (flagText(f) ? `${text}  ${flagText(f)}` : text)

// Branch groups under the root, then detached worktrees; the needs-action ones first within each.
export const treeItems = (rows: readonly WorktreeRow[], branches: readonly WorktreeBranch[]): TreeItem[] => {
  const main = rows[0]
  const others = rows.slice(1)
  const items: TreeItem[] = []
  for (const branch of branches) {
    if (main && branch.worktree === main.path) continue
    const row = branch.worktree ? others.find(r => r.path === branch.worktree) : undefined
    const flags = row ?? { changes: 0, live: 0, ahead: branch.ahead ?? 0, behind: branch.behind ?? 0 }
    items.push({ key: branch.name, label: branch.name, flags, path: row?.path, action: needsAction(flags) })
  }
  for (const row of others.filter(r => r.detached)) {
    items.push({ key: `detached:${row.path}`, label: `⊘ ${row.head}`, flags: row, path: row.path, action: needsAction(row) })
  }
  return items.sort((a, b) => Number(b.action) - Number(a.action) || a.key.localeCompare(b.key))
}

// Each live session counts once, for the worktree it sits in. Linked worktrees live under the main checkout,
// so the longest matching path wins: a session in <repo>/.claude/worktrees/x is not also counted for <repo>.
export const liveByTree = (cwds: readonly string[], paths: readonly string[]): Map<string, number> => {
  const counts = new Map<string, number>()
  for (const cwd of cwds) {
    const owner = paths
      .filter(path => cwd === path || cwd.startsWith(`${path}/`))
      .sort((a, b) => b.length - a.length)[0]
    if (owner) counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  return counts
}

// Order of selection: the root first, then the items in display order.
export const treeKeys = (rows: readonly WorktreeRow[], branches: readonly WorktreeBranch[]): string[] =>
  rows[0] ? [rows[0].path, ...treeItems(rows, branches).map(item => item.key)] : []

const legendLines = (): TreeLine[] => [
  { text: `${SYMBOL.branch} branch   ${SYMBOL.ahead} ahead   ${SYMBOL.behind} behind   ${SYMBOL.dirty} changed files   ${SYMBOL.live} live sessions   ${SYMBOL.detached} detached   ${SYMBOL.prunable} prunable`, color: PALETTE.muted },
  { text: '' },
]

// The hybrid tree: main checkout at the root, each branch a group, its worktree nested under it.
export const treeLines = (rows: readonly WorktreeRow[], branches: readonly WorktreeBranch[], legend: boolean, selected: string | undefined): TreeLine[] => {
  const main = rows[0]
  if (!main) return []
  const mark = (key: string) => (key === selected ? '›' : ' ')
  const items = treeItems(rows, branches)
  const lines: TreeLine[] = legend ? legendLines() : []
  lines.push({ key: main.path, text: withFlags(`${mark(main.path)}${basename(main.path)}  ${main.branch ?? `⊘ ${main.head}`}`, main) })
  if (items.length > 0) lines.push({ text: '|' })
  items.forEach((item, index) => {
    const last = index === items.length - 1
    lines.push({ key: item.key, text: withFlags(`${mark(item.key)}${last ? '\\' : '|'}__ ${item.label}`, item.flags), color: item.action ? undefined : PALETTE.muted })
    if (item.path) lines.push({ text: `${last ? ' ' : '|'}   \\__ ${basename(item.path)}`, color: PALETTE.muted })
  })
  return lines
}

// Detail for the selected row: shown below the tree, secondary to it.
export const detailLines = (row: WorktreeRow | undefined): TreeLine[] => row ? [
  { text: '' },
  { text: row.path, color: PALETTE.muted },
  { text: `HEAD ${row.head}  ${row.branch ?? 'detached'}  ${row.changes} changed · ${row.ahead} ahead · ${row.behind} behind · ${row.live} live`, color: PALETTE.muted },
] : []
