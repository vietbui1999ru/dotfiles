import { atom, read, update, type EngineInterface } from 'claude-code'

import { AUTO_CLEAR_TOKENS, introText, readClearResult, shouldClear, shouldSkipCompact, type ClearCheck } from './auto-clear'
import { SAVE_FAILED } from './summary'

// True after a failed auto-clear save: compaction is back on until a later clear succeeds.
export const saveFailed = atom({ plugin: 'session-band', key: 'autoClearSaveFailed' } as const, false)

const BUSY = new Set(['pending', 'running', 'waiting'])

// Whether the last auto-clear save failed; register.tsx reads it through here, since it owns no atom of its own.
export async function autoClearFailed($: EngineInterface): Promise<boolean> {
  return read($, saveFailed)
}

async function isTaskSession($: EngineInterface): Promise<boolean> {
  const root = await $.session.root().catch(() => '')
  if (root === '') return false
  const text = await $.fs.read(`${root}/.agent-task-id`).catch(() => undefined)
  return typeof text === 'string' && text.trim() !== ''
}

async function agentsBusy($: EngineInterface): Promise<boolean> {
  const agents = await $.agent.list().catch(() => [])
  return agents.some(agent => BUSY.has(agent.status))
}

// The end-of-turn clear, called from register.tsx's turn.complete hook after next(e). It never throws; a failure is a no-op.
export async function endOfTurn($: EngineInterface, e: { agentId?: string; reason: string }): Promise<void> {
  try {
    const { context } = await $.session.usage()
    const tokens = context.tokens
    const failed = await read($, saveFailed)
    if (tokens === undefined || tokens < AUTO_CLEAR_TOKENS) {
      await update($, saveFailed, () => false)
      return
    }

    const check: ClearCheck = {
      agentId: e.agentId,
      isTaskSession: await isTaskSession($),
      turnReason: e.reason,
      tokens,
      agentsBusy: await agentsBusy($),
      draft: (await $.prompt.read()).text,
      saveFailed: failed,
    }
    if (!shouldClear(check)) return

    const cleared = await $.command.run({ command: 'clear' }).catch(() => undefined)
    const outcome = cleared === undefined
      ? { kind: 'failed' as const, text: SAVE_FAILED }
      : readClearResult(cleared.text)
    if (outcome.kind === 'failed') {
      await update($, saveFailed, () => true)
      await $.ui.toast(`Auto-clear stopped: ${outcome.text} Compaction is back on.`)
      return
    }

    await update($, saveFailed, () => false)
    void $.prompt.submit({ text: introText(tokens, outcome) }).catch(() => undefined)
  } catch {
    // Auto-clear is best effort: a failed read leaves the session as it was.
  }
}

// Claude's automatic compaction is held back below the ceiling; everything else falls through to next(e).
export async function onCompact($: EngineInterface, e: { trigger: string; agentId?: string }, next: () => unknown): Promise<unknown> {
  try {
    const { context } = await $.session.usage()
    const skip = shouldSkipCompact({
      trigger: e.trigger,
      agentId: e.agentId,
      isTaskSession: await isTaskSession($),
      tokens: context.tokens,
      saveFailed: await read($, saveFailed),
    })
    if (skip) return { skip: 'auto-clear runs at the end of this turn' }
  } catch {
    // Any failure here lets Claude's compaction run, as it would without this hook.
  }
  return next()
}
