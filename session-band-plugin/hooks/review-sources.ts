import type { EngineInterface } from 'claude-code'

import { acRunArgv, parseReviewList, REVIEW_LIST_ARGV, specRows } from './gates'
import { statePath, type SessionReview } from './review-touch'
import type { AgentKey } from './review-thread'

// One agent's unapproved work in a worktree: a Pi run, a Claude session, or a spec.
// `base` is what its diff is taken against: a Pi record's base commit, a Claude
// session's base tree, and nothing for a spec (which draws no diff).
export type ReviewAgent = {
  key: AgentKey
  kind: 'pi' | 'claude' | 'spec'
  label: string
  files: string[]
  base: string
  runId?: string
  specPath?: string
}

// A tab is one (agent, file) pair. `shared` names the other agents that touched the
// same file: attribution is best effort, so the tab says who else is on it.
export type ReviewTab = {
  key: string
  agent: AgentKey
  kind: ReviewAgent['kind']
  label: string
  file: string
  base: string
  runId?: string
  specPath?: string
  shared?: string[]
  unread?: boolean
}

// What `/gates` asks the pane to select when it opens it (`v` on a row).
export type ReviewFocus = { kind: ReviewAgent['kind']; runId?: string; specPath?: string; worktree?: string }

// The pane's atom: the tabs it drew, the cursor, and the small facts that must
// survive a redraw (a half-typed comment, the cycler, which answers were toasted).
export type ReviewPaneState = {
  tabs: ReviewTab[]
  selected?: string
  hunk: number
  focus?: ReviewFocus
  composer?: { tab: string; kind: 'comment' | 'patch'; text: string }
  answerer?: Record<string, number>
  unread?: Record<string, boolean>
  notified?: string[]
  confirm?: string
  returned?: Record<string, string[]>
  note?: string
  findings?: Record<string, string[]>
  lens?: Record<string, string[]>
  checks?: Record<string, string>
}


export const tabKey = (agent: AgentKey, file: string): string => `${agent}\u0000${file}`

const trimSlash = (path: string): string => path.replace(/\/+$/, '')

type Record_ = { [key: string]: unknown }
const object = (value: unknown): Record_ | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record_ : undefined

type PiRecord = { runId: string; files: string[]; base: string; session?: string; name?: string }

/** A pending record's fields the pane needs; absent or malformed fields make it unusable. */
export const parsePiRecord = (json: string): PiRecord | undefined => {
  try {
    const value = object(JSON.parse(json))
    if (!value || typeof value.runId !== 'string' || typeof value.base !== 'string' || !Array.isArray(value.files)) return undefined
    const files = value.files.flatMap(row => {
      const item = object(row)
      return typeof item?.file === 'string' ? [item.file] : []
    })
    if (files.length === 0) return undefined
    return {
      runId: value.runId,
      files,
      base: value.base,
      ...(typeof value.session === 'string' && value.session !== '' ? { session: value.session } : {}),
      ...(typeof value.name === 'string' && value.name !== '' ? { name: value.name } : {}),
    }
  } catch {
    return undefined
  }
}

const parseSession = (json: string): SessionReview | undefined => {
  try {
    const value = object(JSON.parse(json))
    if (!value || typeof value.sessionId !== 'string' || typeof value.worktree !== 'string' || typeof value.baseTree !== 'string') return undefined
    if (!Array.isArray(value.touched) || !value.touched.every(item => typeof item === 'string')) return undefined
    return {
      sessionId: value.sessionId,
      worktree: value.worktree,
      baseTree: value.baseTree,
      touched: value.touched as string[],
      ...(typeof value.approvedAt === 'string' ? { approvedAt: value.approvedAt } : {}),
    }
  } catch {
    return undefined
  }
}

const sessionDir = (home: string): string => statePath(trimSlash(home), 'x').replace(/\/x\.json$/, '')

async function piAgents($: EngineInterface, worktree: string): Promise<ReviewAgent[]> {
  const home = await $.env.get('HOME')
  if (!home) return []
  const listing = await $.process.run(REVIEW_LIST_ARGV(home), { cwd: worktree }).catch(() => undefined)
  if (!listing || listing.exitCode !== 0) return []
  const entries = parseReviewList(listing.stdout) ?? []
  const agents: ReviewAgent[] = []
  for (const entry of entries) {
    if (entry.owner !== worktree || entry.orphan || entry.error) continue
    const text = await $.fs.read(`${worktree}/.pi/agent-review/pending/${entry.runId}.json`).catch(() => '')
    const record = parsePiRecord(text)
    if (!record || record.runId !== entry.runId) continue
    agents.push({
      // The thread and the delivery queue key a Pi agent by its session, as plan C does.
      key: `pi:${record.session ?? record.runId}`,
      kind: 'pi',
      label: `pi ${record.name ?? record.runId.slice(0, 8)}`,
      files: record.files,
      base: record.base,
      runId: record.runId,
    })
  }
  return agents
}

async function claudeAgents($: EngineInterface, worktree: string): Promise<ReviewAgent[]> {
  const home = await $.env.get('HOME')
  if (!home) return []
  const dir = sessionDir(home)
  const listing = await $.fs.list(dir).catch(() => [])
  const agents: ReviewAgent[] = []
  for (const file of listing) {
    if (file.kind !== 'file' || !file.name.endsWith('.json')) continue
    const session = parseSession(await $.fs.read(`${dir}/${file.name}`).catch(() => ''))
    // An approved session has no touched files, so it needs no tab.
    if (!session || trimSlash(session.worktree) !== worktree || session.touched.length === 0) continue
    agents.push({
      key: `claude:${session.sessionId}`,
      kind: 'claude',
      label: `claude ${session.sessionId.slice(0, 8)}`,
      files: [...session.touched].sort(),
      base: session.baseTree,
    })
  }
  return agents.sort((left, right) => left.key.localeCompare(right.key))
}

/** The specs `/gates` lists, minus the approved ones: each is a review item, not a diff. */
export async function specAgents($: EngineInterface, worktree: string, home?: string): Promise<ReviewAgent[]> {
  const branch = await $.process.run(['git', '-C', worktree, 'rev-parse', '--abbrev-ref', 'HEAD']).catch(() => undefined)
  const name = branch?.exitCode === 0 ? branch.stdout.trim() : ''
  if (name === '') return []
  const nested = await $.fs.list(`${worktree}/specs`).catch(() => [])
  const rels = ['SPEC.md', ...nested.filter(file => file.kind === 'file' && file.name.endsWith('.md')).map(file => `specs/${file.name}`)]
  const files = await Promise.all(rels.map(async rel => ({ rel, text: await $.fs.read(`${worktree}/${rel}`).catch(() => '') })))
  const rows = specRows({ path: worktree, head: '', branch: name, detached: false, prunable: false }, files)
  const agents: ReviewAgent[] = []
  for (const row of rows) {
    if (home) {
      const status = await $.process.run(acRunArgv(home, 'status', row.path), { cwd: worktree }).catch(() => undefined)
      // 0 is approved; anything else (draft, stale, invalid, unavailable) still wants review.
      if (status?.exitCode === 0) continue
    }
    agents.push({
      key: `spec:${row.path}`,
      kind: 'spec',
      label: `spec ${row.rel}`,
      files: [row.rel],
      base: '',
      specPath: row.path,
    })
  }
  return agents
}

/** Every unapproved agent in this worktree, Pi runs and Claude sessions together. */
export async function loadAgents($: EngineInterface, worktree: string): Promise<ReviewAgent[]> {
  const root = trimSlash(worktree)
  const home = await $.env.get('HOME')
  const [pi, claude, specs] = await Promise.all([piAgents($, root), claudeAgents($, root), specAgents($, root, home)])
  return [...pi, ...claude, ...specs]
}

/** One tab per (agent, file), naming the other agents that touched a shared file. */
export const buildTabs = (agents: readonly ReviewAgent[]): ReviewTab[] =>
  agents.flatMap(agent => agent.files.map(file => {
    const shared = agents.filter(other => other.key !== agent.key && other.files.includes(file)).map(other => other.label)
    return {
      key: tabKey(agent.key, file),
      agent: agent.key,
      kind: agent.kind,
      label: agent.label,
      file,
      base: agent.base,
      ...(agent.runId === undefined ? {} : { runId: agent.runId }),
      ...(agent.specPath === undefined ? {} : { specPath: agent.specPath }),
      ...(shared.length === 0 ? {} : { shared }),
    }
  }))

/** `git diff <base> -- <file>` against the working tree, as the tab draws it. */
export async function fileDiff($: EngineInterface, worktree: string, base: string, file: string): Promise<string> {
  if (base === '') return ''
  const result = await $.process.run(['git', '-C', worktree, 'diff', '--no-renames', base, '--', file]).catch(() => undefined)
  return result && result.exitCode === 0 ? result.stdout : ''
}

export type DiffView = { kind: 'diff' | 'binary' | 'deleted' | 'empty'; text: string; summary?: string }

/** A binary or deleted file has no hunks to draw; the tab shows one line instead. */
export const describeDiff = (file: string, diff: string): DiffView => {
  if (diff.trim() === '') return { kind: 'empty', text: '' }
  if (/^Binary files .* differ$/m.test(diff) || diff.includes('GIT binary patch')) {
    return { kind: 'binary', text: '', summary: `${file}: binary file, no diff` }
  }
  if (/^deleted file mode /m.test(diff) || /^\+\+\+ \/dev\/null$/m.test(diff)) {
    return { kind: 'deleted', text: '', summary: `${file}: deleted, no diff` }
  }
  return { kind: 'diff', text: diff }
}

export type Hunk = { index: number; header: string; oldStart: number; oldCount: number; newStart: number; newCount: number; lines: string[] }

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/** The diff before its first hunk (the file header) and every hunk in it. */
export const splitHunks = (diff: string): { preamble: string; hunks: Hunk[] } => {
  const hunks: Hunk[] = []
  const preamble: string[] = []
  let current: Hunk | undefined
  for (const line of diff.split('\n')) {
    const match = HUNK.exec(line)
    if (match) {
      current = {
        index: hunks.length,
        header: line,
        oldStart: Number(match[1]),
        oldCount: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newCount: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
      }
      hunks.push(current)
      continue
    }
    if (current) current.lines.push(line)
    else preamble.push(line)
  }
  return { preamble: preamble.join('\n'), hunks }
}

/** A pane draws about 100,000 characters: past that, only the selected hunk is drawn. */
export const PAGE_LIMIT = 100_000

export type DiffPage = { text: string; paged: boolean; at: number; total: number }

export const pageDiff = (diff: string, selected: number, limit = PAGE_LIMIT): DiffPage => {
  const { preamble, hunks } = splitHunks(diff)
  const at = hunks.length === 0 ? 0 : Math.min(Math.max(0, selected), hunks.length - 1)
  if (hunks.length === 0 || diff.length <= limit) return { text: diff, paged: false, at, total: hunks.length }
  const hunk = hunks[at]
  const text = hunk === undefined ? diff : [preamble, hunk.header, ...hunk.lines].filter(part => part !== '').join('\n')
  return { text, paged: true, at, total: hunks.length }
}

/** The new-file side of a hunk (context and added lines), as the person sees it. */
export const hunkNewLines = (hunk: Hunk): string[] =>
  hunk.lines.filter(line => line.startsWith('+') || line.startsWith(' ')).map(line => line.slice(1))

/** The old-file side of a hunk (context and removed lines), the side a patch replaces. */
export const hunkOldLines = (hunk: Hunk): string[] =>
  hunk.lines.filter(line => line.startsWith('-') || line.startsWith(' ')).map(line => line.slice(1))

/** The first new-file line of a hunk: where a comment made on it anchors. */
export const hunkLine = (hunk: Hunk | undefined): number | undefined => hunk === undefined ? undefined : hunk.newStart

/**
 * A typed edit of a hunk as a unified diff: the hunk's old side replaced by the typed
 * lines. Visible context lines become `-`/`+` pairs, which still match exactly.
 */
export const editPatch = (file: string, hunk: Hunk, typed: string): string => {
  const oldLines = hunkOldLines(hunk)
  const next = typed.split('\n')
  if (next.length > 0 && next[next.length - 1] === '') next.pop()
  return [
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${hunk.oldStart},${oldLines.length} +${hunk.newStart},${next.length} @@`,
    ...oldLines.map(line => `-${line}`),
    ...next.map(line => `+${line}`),
  ].join('\n') + '\n'
}

/** A spec tab's acceptance criteria and verify commands, from `ac-run show`. */
export async function specShow($: EngineInterface, worktree: string, specPath: string): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) return ''
  const result = await $.process.run(acRunArgv(home, 'show', specPath), { cwd: worktree }).catch(() => undefined)
  return result && result.exitCode === 0 ? result.stdout.trim() : ''
}

/** The spec's last check run in this pane is stored in the atom; `C` runs it and records the table. */
export async function specCheck($: EngineInterface, worktree: string, specPath: string): Promise<string> {
  const home = await $.env.get('HOME')
  if (!home) return 'ac-run unavailable'
  const runnable = await $.process.run(acRunArgv(home, 'show', specPath), { cwd: worktree }).catch(() => undefined)
  const count = runnable?.stdout.split('\n').filter(line => line.trimStart().startsWith('runs:')).length ?? 0
  const result = await $.process.run(acRunArgv(home, 'check', specPath), { cwd: worktree, timeoutMs: Math.min((75 + 120 * count + 30) * 1000, 600_000) }).catch(() => undefined)
  return result === undefined ? 'ac-run check unavailable' : (result.stdout.trim() || result.stderr.trim() || `check exited ${result.exitCode}`)
}

export type FloorFinding = { file: string; line: number; text: string }

/** `floor-guard --base <base>` findings, one per line, filtered to one file. */
export async function floorFindings($: EngineInterface, worktree: string, base: string, file: string): Promise<string[]> {
  const home = await $.env.get('HOME')
  if (!home || base === '') return []
  const result = await $.process.run([`${home}/dotfiles/scripts/floor-guard`, '--base', base], { cwd: worktree, timeoutMs: 120_000 }).catch(() => undefined)
  if (!result) return []
  return result.stdout.split('\n')
    .map(line => line.trim())
    .filter(line => line !== '')
    .filter(line => line.startsWith(`${file}:`))
}

/**
 * pi-lens diagnostics for a file, when a run left them: a JSON array of
 * `{ file, line, message, severity? }` at `.pi-lens/diagnostics.json`. Absent, empty.
 */
export async function lensDiagnostics($: EngineInterface, worktree: string, file: string): Promise<string[]> {
  const text = await $.fs.read(`${worktree}/.pi-lens/diagnostics.json`).catch(() => '')
  if (text.trim() === '') return []
  try {
    const rows: unknown = JSON.parse(text)
    if (!Array.isArray(rows)) return []
    return rows.flatMap(row => {
      const item = object(row)
      if (typeof item?.file !== 'string' || item.file !== file || typeof item.message !== 'string') return []
      const line = typeof item.line === 'number' ? item.line : undefined
      return [`${item.severity === undefined ? 'diagnostic' : String(item.severity)}${line === undefined ? '' : `:${line}`}: ${item.message}`]
    })
  } catch {
    return []
  }
}
