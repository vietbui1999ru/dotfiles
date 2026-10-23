import type { EngineInterface, Register } from 'claude-code'

import { batchFiles, markBatch, readQueue, worktreeRoot } from './review-batch'
import { appendEntry, readThread, type ThreadEntry } from './review-thread'

/** What the agent sends back for one file of a batch: a verdict per proposed patch, its text, an alternative patch. */
export type ReviewReply = {
  batch: string
  file: string
  verdicts?: readonly { entry: string; verdict: 'agree' | 'clapback' }[]
  text: string
  patch?: string
}

export type ReplyResult = { text: string; isError?: true }

const REFUSED = (batchId: string) => `unknown or undelivered review batch ${batchId}`

// The model and effort of the turn that answers: a subagent's by its id, the main loop's by ''.
const steps = new Map<string, { model?: string; effort?: string }>()

export const REVIEW_REPLY_DESCRIPTION = 'Answer one file of a review batch from the diff review pane: a verdict for each proposed patch, your reply, and an alternative patch when you disagree.'

export const REVIEW_REPLY_SCHEMA = {
  type: 'object',
  properties: {
    batch: { type: 'string', description: 'The batch id from the message\'s first line, `[review-batch <id>]`.' },
    file: { type: 'string', description: 'The file this reply answers, as the batch names it.' },
    verdicts: {
      type: 'array',
      description: 'One verdict per proposed patch of that file.',
      items: {
        type: 'object',
        properties: {
          entry: { type: 'string', description: 'The entry id under `### proposed patch <id>`.' },
          verdict: { type: 'string', enum: ['agree', 'clapback'] },
        },
        required: ['entry', 'verdict'],
      },
    },
    text: { type: 'string', description: 'Your reply. A disagreement says why.' },
    patch: { type: 'string', description: 'An alternative unified diff, when you disagree.' },
  },
  required: ['batch', 'file', 'text'],
}

const answered = (entries: readonly ThreadEntry[], batchId: string, file: string): boolean =>
  entries.some(entry => entry.batch === batchId && entry.file === file && (entry.kind === 'reply' || entry.kind === 'clapback'))

/**
 * Writes one reply into the batch's thread, the entry naming the batch so a redelivered batch shows once,
 * and answers the batch once every one of its files has a reply. An unknown or undelivered batch, and a
 * file already answered in that batch, write nothing: the first is refused, the second is ignored.
 */
export async function recordReply($: EngineInterface, worktree: string, reply: ReviewReply, answer: { model?: string; effort?: string } = {}): Promise<ReplyResult> {
  const queue = await readQueue($, worktree)
  const batch = queue.find(item => item.id === reply.batch)
  if (!batch || batch.state === 'queued' || batch.state === 'no-reply') return { text: REFUSED(reply.batch), isError: true }

  const thread = await readThread($, worktree, batch.agent, reply.file)
  if (answered(thread, batch.id, reply.file)) {
    return { text: `already answered ${reply.file} in batch ${batch.id}; this reply was ignored` }
  }

  const clapback = (reply.verdicts ?? []).some(verdict => verdict.verdict === 'clapback')
  const replyTo = reply.verdicts?.find(verdict => verdict.entry !== '')?.entry
  const entry: ThreadEntry = {
    id: crypto.randomUUID(),
    at: new Date(await $.clock.now()).toISOString(),
    agent: batch.agent,
    file: reply.file,
    kind: clapback ? 'clapback' : 'reply',
    author: 'agent',
    text: reply.text,
    batch: batch.id,
    verdict: clapback ? 'clapback' : 'agree',
    ...(replyTo === undefined ? {} : { replyTo }),
    ...(reply.patch === undefined ? {} : { patch: reply.patch }),
    ...(answer.model === undefined || answer.model === '' ? {} : { model: answer.model }),
    ...(answer.effort === undefined ? {} : { effort: answer.effort }),
  }
  await appendEntry($, worktree, entry)

  let complete = true
  for (const file of await batchFiles($, worktree, batch)) {
    const entries = file === reply.file ? [...thread, entry] : await readThread($, worktree, batch.agent, file)
    if (!answered(entries, batch.id, file)) complete = false
  }
  if (complete) {
    await markBatch($, worktree, batch.id, 'answered', { answeredAt: new Date(await $.clock.now()).toISOString() })
    return { text: `reply recorded for ${reply.file}; batch ${batch.id} is answered` }
  }
  return { text: `reply recorded for ${reply.file}` }
}

/** Declares the tool the model calls to answer: `mcp__session-band__review_reply`. */
export async function registerTool($: EngineInterface): Promise<void> {
  await $.tool.register({ name: 'review_reply', description: REVIEW_REPLY_DESCRIPTION, inputSchema: REVIEW_REPLY_SCHEMA })
}

export const register: Register = on => {
  on('tool.call', { tool: 'mcp__session-band__review_reply' }, async ($, e) => {
    const reply: ReviewReply = {
      batch: typeof e.batch === 'string' ? e.batch : '',
      file: typeof e.file === 'string' ? e.file : '',
      text: typeof e.text === 'string' ? e.text : '',
      ...(Array.isArray(e.verdicts) ? { verdicts: e.verdicts as ReviewReply['verdicts'] } : {}),
      ...(typeof e.patch === 'string' ? { patch: e.patch } : {}),
    }
    const worktree = await worktreeRoot($, await $.session.cwd().catch(() => ''))
    const step = steps.get(e.agentId ?? '') ?? {}
    const model = step.model ?? await $.session.model().catch(() => undefined)
    const result = await recordReply($, worktree, reply, { model, effort: step.effort })
    return { result: { content: [{ type: 'text', text: result.text }], isError: result.isError === true } }
  })

  // The tool answers with the model and effort that wrote it, so the pane can show who replied.
  on('turn.step', async function* ($, e, next) {
    steps.set(e.agentId ?? '', {
      model: e.model,
      ...(typeof e.effort === 'string' ? { effort: e.effort } : {}),
    })
    return yield* next(e)
  })
}
