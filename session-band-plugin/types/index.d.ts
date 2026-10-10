import type { TrackedTask } from '../hooks/handoff'
import type { PiProgress } from '../hooks/pisession'
import type { HandoffState } from '../hooks/handoff.tsx'

export type { TrackedTask } from '../hooks/handoff'
export type { PiProgress } from '../hooks/pisession'

export type GitSnapshot = {
  branch: string
  isDirty: boolean
  ahead: number
  behind: number
  hasUpstream: boolean
  stash: number
  worktree?: string
}

// Whole percentages as the status line showed them; absent off a subscription.
export type Usage = { ctx?: number; five?: number; seven?: number }

declare module 'claude-code' {
  interface PluginState {
    'session-band': {
      usage: Usage
      git: GitSnapshot | null
      outputStyle: string | null
      isNotified: boolean
      edits: number
      prompts: number
      handoff: HandoffState
      progress: Record<number, PiProgress>
    }
  }
}
