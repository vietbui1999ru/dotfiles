import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

// Copies new alerts from ~/.claude/state/mistake-alerts.json into agent-events/events/<YYYY-MM>.jsonl.
// Only normalized fields leave the machine: fingerprint, time, session id, repo name. Never the cwd path or raw error text.
export const ALERTS_PATH = join(homedir(), '.claude', 'state', 'mistake-alerts.json')
export const DEFAULT_REPO = join(homedir(), 'repos', 'agent-events')

export const eventKey = alert => `${alert.sessionId}|${alert.at}|${alert.fingerprint}`

// Pure: the JSONL lines for alerts not yet in the log, each with a date-based file name.
export const newEvents = (alerts, existingKeys) => alerts
  .filter(alert => !existingKeys.has(eventKey(alert)))
  .map(alert => ({
    file: `${new Date(alert.at).toISOString().slice(0, 7)}.jsonl`,
    line: JSON.stringify({
      fingerprint: alert.fingerprint,
      at: new Date(alert.at).toISOString(),
      session: alert.sessionId,
      repo: alert.cwd ? basename(alert.cwd) : undefined,
      status: alert.status,
    }),
    key: eventKey(alert),
  }))

const readKeys = dir => {
  const keys = new Set()
  if (!existsSync(dir)) return keys
  for (const file of readdirSync(dir).filter(name => name.endsWith('.jsonl'))) {
    for (const line of readFileSync(join(dir, file), 'utf8').split('\n').filter(Boolean)) {
      const event = JSON.parse(line)
      keys.add(`${event.session}|${Date.parse(event.at)}|${event.fingerprint}`)
    }
  }
  return keys
}

export const sync = ({ alertsPath = ALERTS_PATH, repo = DEFAULT_REPO, push = true } = {}) => {
  const alerts = existsSync(alertsPath) ? JSON.parse(readFileSync(alertsPath, 'utf8')).alerts ?? [] : []
  const eventsDir = join(repo, 'events')
  mkdirSync(eventsDir, { recursive: true })
  const fresh = newEvents(alerts, readKeys(eventsDir))
  for (const event of fresh) appendFileSync(join(eventsDir, event.file), `${event.line}\n`)
  if (fresh.length > 0 && push) {
    // execFileSync takes argv directly, so no shell sees the commit message.
    execFileSync('git', ['-C', repo, 'add', 'events'])
    execFileSync('git', ['-C', repo, '-c', 'user.name=vietbui99', 'commit', '-qm', `events: ${fresh.length} mistake alert(s)`])
    execFileSync('git', ['-C', repo, 'push', '-q'])
  }
  return fresh.length
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const repoArg = process.argv.indexOf('--repo')
  const repo = repoArg > 0 ? process.argv[repoArg + 1] : DEFAULT_REPO
  console.log(`synced ${sync({ repo, push: !process.argv.includes('--no-push') })} new event(s)`)
}
