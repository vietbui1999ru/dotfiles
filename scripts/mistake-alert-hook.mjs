import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { DEFAULT_MAP, fingerprint, markAlerted, recordOccurrence, shouldAlert, WINDOW_DAYS } from './mistake-fingerprint.mjs'

// Open alerts, every session: the band reads this session's entries, the pane reads the last 14 days across sessions.
export const ALERTS_PATH = join(homedir(), '.claude', 'state', 'mistake-alerts.json')

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback)
const writeJson = (path, value) => {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

// PostToolUseFailure input: tool_name, tool_input.command, error ("Exit code N" first), session_id, cwd.
// Returns the hook output to send, or undefined. The agent sees additionalContext; plain stdout is not fed back.
export const handleFailure = (payload, { mapPath = DEFAULT_MAP, alertsPath = ALERTS_PATH, now = Date.now() } = {}) => {
  if (payload.tool_name !== 'Bash' || payload.is_interrupt) return undefined
  const fp = fingerprint({ tool: 'Bash', command: payload.tool_input?.command, error: payload.error })
  let map = recordOccurrence(readJson(mapPath, {}), fp, now)
  if (!shouldAlert(map[fp], now)) {
    writeJson(mapPath, map)
    return undefined
  }
  map = markAlerted(map, fp, now)
  writeJson(mapPath, map)
  const alerts = readJson(alertsPath, { alerts: [] })
  alerts.alerts.push({ fingerprint: fp, at: now, sessionId: payload.session_id, cwd: payload.cwd, status: 'open' })
  writeJson(alertsPath, alerts)
  return {
    hookSpecificOutput: {
      hookEventName: 'PostToolUseFailure',
      additionalContext: `Repeated mistake: ${fp} (${map[fp].hits.length} hits in ${WINDOW_DAYS} days). Tell the user, and record it with capture-mistake before continuing.`,
    },
  }
}

// A hook must never block the tool: any error exits 0 with no output.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let raw = ''
  process.stdin.on('data', chunk => { raw += chunk })
  process.stdin.on('end', () => {
    try {
      const out = handleFailure(JSON.parse(raw || '{}'))
      if (out) process.stdout.write(JSON.stringify(out))
    } catch {
      // Swallowed on purpose: see above.
    }
    process.exit(0)
  })
}
