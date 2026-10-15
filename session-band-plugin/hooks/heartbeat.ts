// Liveness file for the status line fallback. The mod rewrites it while it runs; claude/.claude/statusline-command.sh
// stays silent while it is fresh and draws itself once it is stale or missing. Keep the directory and name in step
// with the script. The directory is $TMPDIR: a write under ~/.claude/state was not seen (see the mod's other writes).
export const HEARTBEAT_INTERVAL_MS = 15_000

const SAFE_ID = /^[A-Za-z0-9_-]+$/

export const heartbeatPath = (tmp: string, sessionId: string): string | undefined =>
  SAFE_ID.test(sessionId) ? `${tmp}/session-band-${sessionId}.alive` : undefined

export const heartbeatBody = (nowMs: number): string => `${Math.floor(nowMs / 1000)}\n`
