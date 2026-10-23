import type { EngineInterface } from 'claude-code'

import { parseThread, threadDir, type AgentKey, type ThreadEntry } from './review-thread'

// A batch is one agent's unsent feedback: every entry the person wrote for that agent, sent together.
export type BatchState = 'queued' | 'delivered' | 'answered' | 'no-reply'

export type Batch = {
  id: string
  agent: AgentKey
  entryIds: string[]
  state: BatchState
  queuedAt: string
  deliveredAt?: string
  answeredAt?: string
  reason?: string
  model?: string
  effort?: string
}

// Designer's call: a delivered batch that no agent answered in half an hour is offered for resend, never shown answered.
export const NO_REPLY_MS = 30 * 60_000

const STATES: readonly BatchState[] = ['queued', 'delivered', 'answered', 'no-reply']

export const queueFile = (worktree: string): string => `${threadDir(worktree)}/queue.jsonl`

/**
 * The worktree's repository root: a thread and its queue live beside the review record at the root,
 * so a session started in a subdirectory still finds them. A directory outside git is its own root.
 */
export async function worktreeRoot($: EngineInterface, worktree: string): Promise<string> {
  const result = await $.process.run(['git', '-C', worktree, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() !== '' ? result.stdout.trim() : worktree
}

export const batchDir = (worktree: string): string => `${threadDir(worktree)}/batches`

const isBatch = (value: unknown): value is Batch => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return typeof row.id === 'string' && row.id !== ''
    && typeof row.agent === 'string'
    && typeof row.state === 'string' && STATES.includes(row.state as BatchState)
    && typeof row.queuedAt === 'string'
    && Array.isArray(row.entryIds) && row.entryIds.every(id => typeof id === 'string')
}

/**
 * The queue's batches, oldest first: the latest line for a batch id wins, and a batch keeps the
 * place its first line gave it. A torn or unreadable line (a crash mid-append) is skipped.
 */
export const parseQueue = (text: string): Batch[] => {
  const order: string[] = []
  const latest = new Map<string, Batch>()
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      continue
    }
    if (!isBatch(value)) continue
    if (!latest.has(value.id)) order.push(value.id)
    latest.set(value.id, value)
  }
  return order.map(id => latest.get(id) as Batch)
}

// As the threads: the whole file goes to a temporary one that is renamed over the queue, so a crash
// leaves the old queue or the new one, never half. Queued lines stay: the latest one wins on read.
async function appendBatch($: EngineInterface, worktree: string, batch: Batch): Promise<void> {
  const path = queueFile(worktree)
  const existing = await $.fs.read(path).catch(() => '')
  const separator = existing === '' || existing.endsWith('\n') ? '' : '\n'
  const tmp = `${path}.tmp`
  await $.fs.write(tmp, `${existing}${separator}${JSON.stringify(batch)}\n`)
  const moved = await $.process.run(['mv', '-f', tmp, path])
  if (moved.exitCode !== 0) throw new Error(`review batch not saved: ${moved.stderr.trim() || 'mv failed'}`)
}

export async function readQueue($: EngineInterface, worktree: string): Promise<Batch[]> {
  const text = await $.fs.read(queueFile(worktree)).catch(() => '')
  return parseQueue(text)
}

/** Writes the batch to the queue (`queued`) and resolves once it is on disk. */
export async function enqueue($: EngineInterface, worktree: string, agent: AgentKey, entries: readonly ThreadEntry[]): Promise<Batch> {
  const batch: Batch = {
    id: crypto.randomUUID(),
    agent,
    entryIds: entries.map(entry => entry.id),
    state: 'queued',
    queuedAt: new Date(await $.clock.now()).toISOString(),
  }
  await appendBatch($, worktree, batch)
  return batch
}

/**
 * Records a new state for one batch. `extra` may add a time, a reason, a model; the id and the
 * agent stay the batch's own. An id the queue does not hold writes nothing: no batch is invented.
 */
export async function markBatch($: EngineInterface, worktree: string, id: string, state: BatchState, extra: Partial<Batch> = {}): Promise<void> {
  const queue = await readQueue($, worktree)
  const current = queue.find(batch => batch.id === id)
  if (!current) return
  await appendBatch($, worktree, { ...current, ...extra, id: current.id, agent: current.agent, state })
}

/** The delivered batches older than the no-reply timeout, each as it should now read: `no-reply`. */
export const expireDelivered = (batches: readonly Batch[], nowMs: number): Batch[] =>
  batches
    .filter(batch => batch.state === 'delivered' && batch.deliveredAt !== undefined && nowMs - Date.parse(batch.deliveredAt) > NO_REPLY_MS)
    .map(batch => ({ ...batch, state: 'no-reply' as const }))

async function readAgentEntries($: EngineInterface, worktree: string, agent: AgentKey): Promise<ThreadEntry[]> {
  const dir = `${threadDir(worktree)}/${encodeURIComponent(agent)}`
  const listing = await $.fs.list(dir).catch(() => [])
  const entries: ThreadEntry[] = []
  for (const file of listing) {
    if (file.kind !== 'file' || !file.name.endsWith('.jsonl')) continue
    entries.push(...parseThread(await $.fs.read(`${dir}/${file.name}`).catch(() => '')))
  }
  return entries
}

/** The batch's entries in the order `enqueue` took them; an entry no thread holds is left out. */
export async function batchEntries($: EngineInterface, worktree: string, batch: Batch): Promise<ThreadEntry[]> {
  const entries = await readAgentEntries($, worktree, batch.agent)
  const held = new Map(entries.map(entry => [entry.id, entry]))
  return batch.entryIds.flatMap(id => {
    const entry = held.get(id)
    return entry ? [entry] : []
  })
}

/** The files the batch's entries belong to, first mention first: a reply answers every one of them. */
export async function batchFiles($: EngineInterface, worktree: string, batch: Batch): Promise<string[]> {
  const files: string[] = []
  for (const entry of await batchEntries($, worktree, batch)) {
    if (!files.includes(entry.file)) files.push(entry.file)
  }
  return files
}

const howToReply = (batchId: string, replyHow: 'tool' | 'cli', worktree: string): string =>
  replyHow === 'tool'
    ? `Call \`review_reply\` once per file above with batch \`${batchId}\`, the file, a verdict for each proposed patch (\`agree\` or \`clapback\`), and your reply text. A disagreement must be a \`clapback\` and say why.`
    : `Run this once per file above, in ${worktree}:\n\n$HOME/dotfiles/scripts/review-reply --worktree ${worktree} --batch ${batchId} --file <file> --verdict agree|clapback --text "<your reply>" [--patch-file <path>]\n\nA disagreement must be a \`clapback\` and say why.`

/**
 * The batch as the agent reads it: the marker line (plan A's absorb reads it), then one section per
 * file, then how to answer. The first line is the marker and nothing precedes it.
 */
export const buildBatchText = (batchId: string, entries: readonly ThreadEntry[], replyHow: 'tool' | 'cli', worktree = '.'): string => {
  const groups: { file: string; entries: ThreadEntry[] }[] = []
  for (const entry of entries) {
    const group = groups.find(item => item.file === entry.file)
    if (group) group.entries.push(entry)
    else groups.push({ file: entry.file, entries: [entry] })
  }
  const sections = groups.map(group => {
    const lines = [`## ${group.file}`]
    for (const entry of group.entries) {
      if (entry.patch !== undefined) {
        lines.push('', `### proposed patch ${entry.id}`, '', '```diff', entry.patch.replace(/\n$/, ''), '```')
      } else {
        lines.push(entry.line === undefined ? `- ${entry.text}` : `- L${entry.line}: ${entry.text}`)
      }
    }
    return lines.join('\n')
  })

  return [`[review-batch ${batchId}]`, ...sections, '', '## How to reply', howToReply(batchId, replyHow, worktree)].join('\n\n') + '\n'
}
