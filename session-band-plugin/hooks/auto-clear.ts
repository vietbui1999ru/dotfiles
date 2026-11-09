// Pure logic for auto-clear: at the end of a main turn past THRESHOLD_TOKENS, the session is saved through the
// /clear flow, cleared, and handed an intro turn. No engine imports: every `$` call stays in auto-clear.tsx.

import { CANCELLED, REFUSED, SAVE_FAILED } from './summary'
import { THRESHOLD_TOKENS } from './threshold'

export const AUTO_CLEAR_TOKENS = THRESHOLD_TOKENS
// Above this the model window is at risk, so Claude's own compaction is let through.
export const COMPACT_CEILING_TOKENS = 900_000

export type ClearCheck = {
  agentId?: string
  isTaskSession: boolean
  isRefusal: boolean
  tokens: number | undefined
  agentsBusy: boolean
  draft: string
  saveFailed: boolean
}

// Clear only a main, non-task session at or over the threshold, with nothing running and nothing typed.
export const shouldClear = (c: ClearCheck): boolean =>
  c.agentId === undefined &&
  !c.isTaskSession &&
  !c.isRefusal &&
  c.tokens !== undefined &&
  c.tokens >= AUTO_CLEAR_TOKENS &&
  !c.agentsBusy &&
  c.draft.trim() === '' &&
  !c.saveFailed

export type CompactCheck = {
  trigger: string
  agentId?: string
  isTaskSession: boolean
  tokens: number | undefined
  saveFailed: boolean
}

// Skip Claude's automatic compaction while auto-clear can still handle the session; a failed save or a session
// near the model limit lets compaction run.
export const shouldSkipCompact = (c: CompactCheck): boolean =>
  c.trigger === 'auto' &&
  c.agentId === undefined &&
  !c.isTaskSession &&
  !c.saveFailed &&
  (c.tokens === undefined || c.tokens < COMPACT_CEILING_TOKENS)

export type ClearResult = { kind: 'saved'; path: string } | { kind: 'failed'; text: string } | { kind: 'cleared' }

const SAVED = /^Session saved: (.+)$/

// The /clear command's text: a saved path, one of the failure texts, or a clean clear (no real work, or a recent save).
export const readClearResult = (text: string): ClearResult => {
  const saved = SAVED.exec(text.trim())
  if (saved !== null) return { kind: 'saved', path: (saved[1] ?? '').trim() }
  if (text.startsWith(REFUSED) || text.startsWith(CANCELLED) || text.startsWith(SAVE_FAILED)) {
    return { kind: 'failed', text }
  }
  return { kind: 'cleared' }
}

// The intro turn: says the session was auto-cleared, where the save went, and waits for the person before acting.
export const introText = (tokens: number | undefined, result: ClearResult): string => {
  const at = tokens === undefined ? '' : ` at about ${Math.round(tokens / 1000)}K tokens`
  const saved = result.kind === 'saved'
    ? `The session state was saved to ${result.path}.`
    : 'No session file was written (no real work, or one was saved in the last five minutes). Run `agent-session active` to find the latest one.'

  return [
    `This session was auto-cleared${at}. ${saved}`,
    'Read that file if it exists, then ask me for the goal, what is done, and what is next.',
    'Wait for my confirmation before acting.',
  ].join('\n\n')
}
