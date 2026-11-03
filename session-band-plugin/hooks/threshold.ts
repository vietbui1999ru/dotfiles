import { DENY_AGENT, firstCrossing, stillOver } from './messages'

// Sessions are capped at 500K tokens (CLAUDE_CODE_AUTO_COMPACT_WINDOW), not the
// 1M model window, so the guard measures tokens: 70% of the cap is 350K.
export const CAP_TOKENS = 500_000
export const THRESHOLD_TOKENS = 350_000
export const SAVE_DEBOUNCE_MS = 5 * 60 * 1000

const SAVE_PATHS = ['session-state.md', '.state.md', 'agents/claimed/', 'memory/', 'MEMORY.md', 'log.md']
const SAVE_COMMANDS = ['session-state.md', 'agents/claimed/', '.state.md']

// Percent of the 500K cap; above 100 only if compaction has not run yet.
export const capPercent = (tokens: number | undefined): number | undefined =>
  tokens === undefined ? undefined : (tokens / CAP_TOKENS) * 100

export type SoftStopCheck = {
  tokens?: number
  tool: string
  filePath?: string
  command?: string
  lastSavedMs?: number
  nowMs: number
  isNotified: boolean
  taskId?: string
}

export type SoftStop = { action: 'pass' } | { action: 'clear' } | { action: 'notify'; text: string }

// PreToolUse half: only Agent spawns are refused, so save workflows never stall.
export const guardAgent = (tokens: number | undefined, tool: string): string | undefined =>
  tool === 'Agent' && tokens !== undefined && tokens >= THRESHOLD_TOKENS ? DENY_AGENT : undefined

const isSaveCritical = (c: SoftStopCheck): boolean =>
  SAVE_PATHS.some(p => c.filePath?.includes(p)) ||
  (c.tool === 'Bash' && SAVE_COMMANDS.some(p => c.command?.includes(p)))

// PostToolUse half: one directive per crossing, a shorter re-fire while still over.
export const softStop = (c: SoftStopCheck): SoftStop => {
  if (c.tokens === undefined) return { action: 'pass' }
  if (c.tokens < THRESHOLD_TOKENS) return { action: 'clear' }
  if (isSaveCritical(c)) return { action: 'pass' }
  // A save in the last 5 minutes is probably a post-clear false positive.
  if (c.lastSavedMs !== undefined && c.nowMs - c.lastSavedMs <= SAVE_DEBOUNCE_MS) return { action: 'pass' }

  return { action: 'notify', text: (c.isNotified ? stillOver : firstCrossing)(c.taskId) }
}
