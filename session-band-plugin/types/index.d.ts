export type PueueState = 'Queued' | 'Running' | 'Paused' | 'Done' | 'Failed' | 'Killed' | 'Other'

export type PueueTask = {
  id: number
  label?: string
  cwd: string
  state: PueueState
  exit?: number
  createdMs?: number
  enqueuedMs?: number
  startMs?: number
  endMs?: number
  command: string
}

export type TranscriptEntry = { kind: 'text' | 'tool' | 'error'; text: string }

export type PiProgress = {
  offset: number
  partial: string
  tokens: number
  cost: number
  model?: string
  effort?: string
  lastActivity?: string
  lastEventMs?: number
  lastEventAssistant?: boolean
  files: string[]
  entries: TranscriptEntry[]
  error?: string
  models: Record<string, number>
}

export type TrackedTask = {
  id: number
  sessionId?: string
  label?: string
  cwd: string
  addedMs: number
  task?: PueueTask
  finishedMs?: number
  dismissed?: boolean
}

export type HandoffState = { tasks: TrackedTask[]; available: boolean; selectedId?: number }

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
