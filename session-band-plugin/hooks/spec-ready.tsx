import type { EngineInterface } from 'claude-code'

import { READY_DIR, askText, dirOf, parseMarker } from './spec-ready'
import { approveTimeoutMs, specArgv } from './gates'

const SPEC_READY_MS = 10_000

let isInteractive = false
// A prompt is open: a tick that fires meanwhile does nothing.
let asking = false
// Hashes already put to the person this session (answered, dismissed or skipped); never asked twice.
const asked = new Set<string>()

export const captureSpecSession = (interactive: boolean) => {
  isInteractive = interactive
}

const runsCount = (summary: string) => summary.split('\n').filter(line => line.trimStart().startsWith('runs:')).length

const lastLine = (text: string) => text.split('\n').map(line => line.trim()).filter(Boolean).pop()

async function readyFiles($: EngineInterface, home: string) {
  const entries = await $.fs.list(READY_DIR(home)).catch(() => [])
  return entries.filter(entry => entry.kind === 'file' && entry.name.endsWith('.json'))
}

async function nextMarker($: EngineInterface, home: string) {
  for (const file of await readyFiles($, home)) {
    const marker = parseMarker(await $.fs.read(`${READY_DIR(home)}/${file.name}`).catch(() => ''))
    const hash = marker?.hash ?? file.name.replace(/\.json$/, '')
    if (asked.has(hash)) continue
    if (!marker) { asked.add(hash); continue }
    return marker
  }
  return undefined
}

async function askOnce($: EngineInterface, home: string) {
  const marker = await nextMarker($, home)
  if (!marker) return
  const cwd = dirOf(marker.spec)
  if (!(await $.fs.exists(marker.spec).catch(() => false))) { asked.add(marker.hash); return }

  const shown = await $.process.run(specArgv(home, 'show', marker.spec), { cwd }).catch(() => undefined)
  if (!shown || shown.exitCode !== 0) { asked.add(marker.hash); return }
  const summary = shown.stdout

  asking = true
  let answer: string
  try {
    answer = await $.ui.ask(askText(marker, summary), ['Approve', 'Deny'])
  } catch {
    // Dismissed: the marker stays, so /gates still lists the spec.
    asked.add(marker.hash)
    return
  } finally {
    asking = false
  }
  asked.add(marker.hash)

  // Another session may have decided while the prompt was open.
  if (!(await $.fs.exists(`${READY_DIR(home)}/${marker.hash}.json`).catch(() => false))) {
    await $.ui.toast(`${marker.rel}: already decided in another session`)
    return
  }

  const argv = answer === 'Approve'
    ? specArgv(home, 'approve', marker.spec)
    : specArgv(home, 'reject', marker.spec)
  const timeoutMs = answer === 'Approve' ? approveTimeoutMs(runsCount(summary)) : undefined
  const result = await $.process.run(argv, timeoutMs === undefined ? { cwd } : { cwd, timeoutMs }).catch(() => undefined)
  if (!result) { await $.ui.toast(`${marker.rel}: spec command failed or timed out`); return }
  await $.ui.toast(lastLine(result.stdout) ?? lastLine(result.stderr) ?? `${marker.rel}: ${answer.toLowerCase()}d`)
}

// Only one prompt is ever open, and a tick never throws out of the timer.
async function tick($: EngineInterface) {
  if (asking) return
  const home = await $.env.get('HOME')
  if (!home) return
  await askOnce($, home)
}

// Called from register.tsx's session.start handler: the engine allows one session.start hook per module set.
// Only an interactive session has someone to answer, so only it starts the timer.
let timer: { cancel(): void } | undefined
export function onSpecReadySessionStart($: EngineInterface) {
  if (!isInteractive) return
  timer?.cancel()
  timer = $.clock.every(SPEC_READY_MS, () => { void tick($).catch(() => undefined) })
}

// The Approve/Deny question for one spec, shared by the prompt and the gates and diff-review panes.
// Resolves to the answer; throws when the person dismisses it, as $.ui.ask does.
export async function askSpec($: EngineInterface, rel: string, summary: string): Promise<string> {
  return $.ui.ask(askText({ rel }, summary), ['Approve', 'Deny'])
}
