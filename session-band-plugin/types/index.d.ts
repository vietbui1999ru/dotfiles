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
    }
  }
}
