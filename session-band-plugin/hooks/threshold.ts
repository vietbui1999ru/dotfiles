import { DENY_AGENT, firstCrossing, stillOver } from './messages'

export const THRESHOLD = 70
export const SAVE_DEBOUNCE_MS = 5 * 60 * 1000

const SAVE_PATHS = ['session-state.md', '.state.md', 'agents/claimed/', 'memory/', 'MEMORY.md', 'log.md']
const SAVE_COMMANDS = ['session-state.md', 'agents/claimed/', '.state.md']

export type SoftStopCheck = {
  percent?: number
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
export const guardAgent = (percent: number | undefined, tool: string): string | undefined =>
  tool === 'Agent' && percent !== undefined && percent >= THRESHOLD ? DENY_AGENT : undefined

const isSaveCritical = (c: SoftStopCheck): boolean =>
  SAVE_PATHS.some(p => c.filePath?.includes(p)) ||
  (c.tool === 'Bash' && SAVE_COMMANDS.some(p => c.command?.includes(p)))

// PostToolUse half: one directive per crossing, a shorter re-fire while still over.
export const softStop = (c: SoftStopCheck): SoftStop => {
  if (c.percent === undefined) return { action: 'pass' }
  if (c.percent < THRESHOLD) return { action: 'clear' }
  if (isSaveCritical(c)) return { action: 'pass' }
  // A save in the last 5 minutes is probably a post-clear false positive.
  if (c.lastSavedMs !== undefined && c.nowMs - c.lastSavedMs <= SAVE_DEBOUNCE_MS) return { action: 'pass' }

  return { action: 'notify', text: (c.isNotified ? stillOver : firstCrossing)(c.taskId) }
}
