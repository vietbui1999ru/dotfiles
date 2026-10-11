// Headless check of the /pi Monitor against real data. Feeds `pueue status --json` and the
// real Pi session files through the plugin's own pure functions and prints the rows the
// Monitor would show for the given task ids, as if this session had dispatched them.
// It cannot check rendering or the Bash hook; those still need an interactive session.
//
// Usage: bun session-band-plugin/scripts/monitor-snapshot.ts <pueue task id>...
import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'

import { monitorRows, type TrackedTask } from '../hooks/handoff.ts'
import { emptyProgress, fold, sessionDir, sessionFileName, type PiProgress } from '../hooks/pisession.ts'
import { parsePiCommand, parseStatus } from '../hooks/pueue.ts'

const ids = new Set(process.argv.slice(2).map(Number))
if (ids.size === 0) {
  console.error('usage: monitor-snapshot.ts <pueue task id>...')
  process.exit(2)
}

const tasks = parseStatus(execFileSync('pueue', ['status', '--json'], { encoding: 'utf8' }))
const sessions = `${homedir()}/.pi/agent/sessions`

const progressFor = (cwd: string, sessionId: string): PiProgress | undefined => {
  const dir = `${sessions}/${sessionDir(cwd)}`
  let files: string[] = []
  try { files = readdirSync(dir) } catch { return undefined }
  const name = files.find(file => sessionFileName(sessionId).test(file))
  return name ? fold(emptyProgress(), readFileSync(`${dir}/${name}`, 'utf8')) : undefined
}

const tracked: TrackedTask[] = []
for (const task of tasks.filter(item => ids.has(item.id))) {
  const parsed = parsePiCommand(task.command)
  // Same rule as the tracker: only Pi dispatches (a --model flag) are tracked at all.
  if (!parsed.model) { console.error(`#${task.id} skipped: not a Pi dispatch, the band would not track it`); continue }
  const label = task.label ?? parsed.label
  tracked.push({ id: task.id, cwd: task.cwd, addedMs: task.createdMs ?? 0, task, ...(parsed.sessionId ? { sessionId: parsed.sessionId } : {}), ...(label ? { label } : {}) })
}
for (const id of ids) if (!tasks.some(task => task.id === id)) console.error(`#${id} skipped: not in pueue`)

const progress: Record<number, PiProgress> = {}
for (const item of tracked) {
  const found = item.sessionId ? progressFor(item.cwd, item.sessionId) : undefined
  if (found) progress[item.id] = found
}

for (const row of monitorRows(tracked, progress, tasks, Date.now())) {
  console.log([row.glyph, `#${row.id}`, row.modelEffort ?? '-', row.elapsed, row.activity, row.tokens, row.cost, row.idle?.text ?? '', row.label ?? ''].join('  '))
}
