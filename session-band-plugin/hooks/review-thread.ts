import type { EngineInterface } from 'claude-code'

// A thread belongs to one agent and one file; the agent key is `pi:<piSessionId>` or `claude:<claudeSessionId>`.
export type AgentKey = string

export type ThreadEntryKind = 'comment' | 'patch' | 'reply' | 'clapback' | 'overrule' | 'system'

// Language-neutral JSON: plan C's Python `scripts/review-reply` appends to the same files.
export type ThreadEntry = {
  id: string
  at: string
  agent: AgentKey
  file: string
  kind: ThreadEntryKind
  author: 'person' | 'agent' | 'pane'
  text: string
  line?: number
  patch?: string
  batch?: string
  verdict?: 'agree' | 'clapback'
  replyTo?: string
  model?: string
  effort?: string
}

const KINDS: readonly ThreadEntryKind[] = ['comment', 'patch', 'reply', 'clapback', 'overrule', 'system']
const AUTHORS = ['person', 'agent', 'pane']

// agent-review's snapshots already exclude `.pi/`, so a thread never appears in a diff of its own.
export const threadDir = (worktree: string): string => `${worktree.replace(/\/+$/, '')}/.pi/agent-review/threads`

// encodeURIComponent escapes `/`, spaces and unicode, so every (agent, file) pair maps to one file name and back.
export const threadFile = (worktree: string, agent: AgentKey, file: string): string =>
  `${threadDir(worktree)}/${encodeURIComponent(agent)}/${encodeURIComponent(file)}.jsonl`

const isEntry = (value: unknown): value is ThreadEntry => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id !== ''
    && typeof row.file === 'string' && row.file !== ''
    && typeof row.kind === 'string' && KINDS.includes(row.kind as ThreadEntryKind)
    && typeof row.agent === 'string'
    && typeof row.author === 'string' && AUTHORS.includes(row.author)
    && typeof row.text === 'string'
    && typeof row.at === 'string'
}

/**
 * The entries of one thread, in order. A line that does not parse (a crash mid-append leaves a
 * truncated last line) or lacks `id`, `kind` and `file` is skipped; the entries before it are kept.
 */
export const parseThread = (text: string): ThreadEntry[] => {
  const entries: ThreadEntry[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (isEntry(value)) entries.push(value)
  }
  return entries
}

/**
 * Appends one entry and resolves once the whole file is written. A file whose last line was cut
 * short keeps that line (it is skipped when read) and gets the new entry on a line of its own.
 */
export async function appendEntry($: EngineInterface, worktree: string, entry: ThreadEntry): Promise<void> {
  const path = threadFile(worktree, entry.agent, entry.file)
  const existing = await $.fs.read(path).catch(() => '')
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  await $.fs.write(path, `${existing}${separator}${JSON.stringify(entry)}\n`)
}

export async function readThread($: EngineInterface, worktree: string, agent: AgentKey, file: string): Promise<ThreadEntry[]> {
  const text = await $.fs.read(threadFile(worktree, agent, file)).catch(() => '')
  return parseThread(text)
}
