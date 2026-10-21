// Liveness file for the status line fallback. The mod rewrites it while it runs; claude/.claude/statusline-command.sh
// stays silent while it is fresh and draws itself once it is stale or missing. Keep the directory and name in step
// with the script. The directory is $TMPDIR: a write under ~/.claude/state was not seen (see the mod's other writes).
export const HEARTBEAT_INTERVAL_MS = 15_000

const SAFE_ID = /^[A-Za-z0-9_-]+$/

export const heartbeatPath = (tmp: string, sessionId: string): string | undefined =>
  SAFE_ID.test(sessionId) ? `${tmp}/session-band-${sessionId}.alive` : undefined

// Written by each band draw (throttled), not by the timer: fresh only while the band is on screen.
// claude/.claude/statusline-command.sh stays silent while this file is fresh.
export const drawnPath = (tmp: string, sessionId: string): string | undefined =>
  SAFE_ID.test(sessionId) ? `${tmp}/session-band-${sessionId}.drawn` : undefined

// "<unix seconds>\t<session cwd>": the worktrees pane reads the cwd to show which worktrees have a live session.
export const heartbeatBody = (nowMs: number, cwd: string): string => `${Math.floor(nowMs / 1000)}\t${cwd}\n`
