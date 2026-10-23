import type { EngineInterface } from 'claude-code'

import { batchEntries, buildBatchText, expireDelivered, markBatch, readQueue, type Batch } from './review-batch'
import { readSession } from './review-touch'

// The housekeeping tick: a delivered batch's no-reply timeout, and the retry of a queued Pi batch.
const TICK_MS = 60_000

// Agent keys are plan B's: a Claude session's batches answer to `claude:<session id>`.
export const claudeAgent = (sessionId: string): string => `claude:${sessionId}`

let warned = false

function noteFailure($: EngineInterface, error: unknown): void {
  if (warned) return
  warned = true
  try {
    $.ui.log(`review delivery: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  } catch {
    // the debug log is best effort
  }
}

const oldestFirst = (batches: readonly Batch[]): Batch[] =>
  [...batches].sort((left, right) => left.queuedAt.localeCompare(right.queuedAt))

async function batchText($: EngineInterface, worktree: string, batch: Batch): Promise<string> {
  return buildBatchText(batch.id, await batchEntries($, worktree, batch), 'tool', worktree)
}

async function delivered($: EngineInterface, worktree: string, batch: Batch, extra: Partial<Batch> = {}): Promise<void> {
  const deliveredAt = new Date(await $.clock.now()).toISOString()
  await markBatch($, worktree, batch.id, 'delivered', { deliveredAt, ...extra })
}

/**
 * Sends one batch to another Claude session. The batch is `delivered` only once the send reaches
 * that session's queue; a refused send leaves it `queued` with the reason on it, so nothing is lost.
 */
export async function deliverToSession($: EngineInterface, worktree: string, batch: Batch, sessionId: string): Promise<void> {
  const sent = await $.session.send({ to: { sessionId }, text: await batchText($, worktree, batch) })
  if (sent.isDelivered) await delivered($, worktree, batch)
  else await markBatch($, worktree, batch.id, 'queued', { reason: sent.reason })
}

// A batch whose answerer was chosen in the pane runs on that model, so the session that wrote the
// code is not re-read on its own model: a fresh answerer gets the batch, the diffs and the plan.
async function spawnAnswerer($: EngineInterface, worktree: string, batch: Batch, sessionId: string): Promise<void> {
  const entries = await batchEntries($, worktree, batch)
  const files = [...new Set(entries.map(entry => entry.file))]
  const base = (await readSession($, sessionId).catch(() => undefined))?.baseTree ?? 'HEAD'
  const diffs: string[] = []
  for (const file of files) {
    const diff = await $.process.run(['git', '-C', worktree, 'diff', '--no-renames', base, '--', file]).catch(() => undefined)
    if (diff && diff.exitCode === 0 && diff.stdout.trim() !== '') diffs.push(`### ${file}\n\n\`\`\`diff\n${diff.stdout.trim()}\n\`\`\``)
  }
  const plan = await $.fs.read(`${worktree}/SPEC.md`).catch(() => '')
  const prompt = [
    `You answer review feedback on the work another session did in ${worktree}.`,
    buildBatchText(batch.id, entries, 'tool', worktree),
    diffs.length > 0 ? `## The files as they stand\n\n${diffs.join('\n\n')}` : '',
    plan.trim() !== '' ? `## The session's plan\n\n${plan.trim()}` : '',
  ].filter(part => part !== '').join('\n\n')

  const spawned = await $.agent.spawn({ prompt, description: `answer review batch ${batch.id.slice(0, 8)}`, model: batch.model })
  if ('deny' in spawned) await markBatch($, worktree, batch.id, 'queued', { reason: spawned.deny })
  else await delivered($, worktree, batch, { model: batch.model, effort: batch.effort })
}

/**
 * Delivers this session's queued batches at the end of its turn: the ones that stay on the session's
 * model as one message, oldest first, each of the others to a fresh answerer on the model the person chose.
 */
export async function deliverOwn($: EngineInterface, worktree: string, sessionId: string): Promise<void> {
  const queue = await readQueue($, worktree)
  const mine = oldestFirst(queue.filter(batch => batch.state === 'queued' && batch.agent === claudeAgent(sessionId)))
  if (mine.length === 0) return
  const model = await $.session.model().catch(() => '')
  const here = mine.filter(batch => batch.model === undefined || batch.model === model)
  const elsewhere = mine.filter(batch => batch.model !== undefined && batch.model !== model)

  if (here.length > 0) {
    const parts: string[] = []
    for (const batch of here) parts.push(await batchText($, worktree, batch))
    const submitted = await $.prompt.submit({ text: parts.join('\n') })
    if ('drop' in submitted) {
      for (const batch of here) await markBatch($, worktree, batch.id, 'queued', { reason: submitted.drop })
    } else {
      for (const batch of here) await delivered($, worktree, batch)
    }
  }
  for (const batch of elsewhere) await spawnAnswerer($, worktree, batch, sessionId)
}

/**
 * The housekeeping tick, once a minute: a delivered batch nobody answered becomes `no-reply`, and
 * queued batches for a Pi session are retried. Registered at session start by register.tsx, which
 * already holds the plugin's one unmatched `session.start` hook.
 */
export async function sweep($: EngineInterface, worktree: string, nowMs: number): Promise<void> {
  for (const batch of expireDelivered(await readQueue($, worktree), nowMs)) {
    await markBatch($, worktree, batch.id, 'no-reply')
  }
}

export function startDelivery($: EngineInterface): void {
  $.clock.every(TICK_MS, () => {
    void (async () => {
      const worktree = await $.session.cwd().catch(() => '')
      if (worktree !== '') await sweep($, worktree, await $.clock.now())
    })().catch(error => noteFailure($, error))
  })
}
