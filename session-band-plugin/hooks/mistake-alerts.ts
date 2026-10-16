// Reads the alerts the PostToolUseFailure hook writes to ~/.claude/state/mistake-alerts.json. Pure: the caller reads the file.
export type MistakeAlert = { fingerprint: string; at: number; sessionId?: string; cwd?: string; status: 'open' | 'recorded' | 'dismissed' }

const DAY_MS = 86_400_000

export const parseAlerts = (text: string | undefined): MistakeAlert[] => {
  try {
    const parsed = JSON.parse(text ?? '{}')
    return Array.isArray(parsed.alerts) ? parsed.alerts : []
  } catch {
    return []
  }
}

// The band counts only this session's open alerts.
export const openForSession = (alerts: readonly MistakeAlert[], sessionId: string): number =>
  alerts.filter(alert => alert.status === 'open' && alert.sessionId === sessionId).length

// The pane lists the last `days` across every session, newest first.
export const recentAlerts = (alerts: readonly MistakeAlert[], nowMs: number, days = 14): MistakeAlert[] =>
  alerts.filter(alert => alert.at >= nowMs - days * DAY_MS).sort((a, b) => b.at - a.at)
