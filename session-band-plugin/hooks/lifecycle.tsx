import { type EngineInterface, type Register } from 'claude-code'

import { addOwner, daemonState, ensureArgvs, freshIds, idleCheck, ownersPath, parseOwners, type Owners } from './lifecycle'

// The id the heartbeat file is named by, read at session start as register.tsx's heartbeat reads it.
// After a /clear the process keeps writing that heartbeat, so the owner keeps that id too.
let ownerId: string | undefined
let timer: { cancel(): void } | undefined
const CHECK_MS = 60_000

const status = async ($: EngineInterface) => {
  const result = await $.process.run(['pueue', 'status', '--json']).catch(() => undefined)
  return daemonState(result?.exitCode ?? 1, result?.stdout ?? '')
}

const ownersFile = async ($: EngineInterface): Promise<string | undefined> => {
  const home = await $.env.get('HOME')
  return home ? ownersPath(await $.env.get('XDG_STATE_HOME'), home) : undefined
}

const readOwners = async ($: EngineInterface, path: string): Promise<Owners> => {
  const text = await $.fs.read(path).catch(() => '')
  return parseOwners(typeof text === 'string' ? text : '')
}

/** `pueued -d` forks and may return before the socket is up; wait up to two seconds for it. */
async function waitUp($: EngineInterface) {
  for (let tries = 0; tries < 10; tries += 1) {
    if ((await status($)).kind === 'up') return
    await $.clock.sleep(200)
  }
}

/** Before a dispatch: start the daemon and the group when the task would not run, then record this session as an owner. */
async function ensure($: EngineInterface) {
  for (const argv of ensureArgvs(await status($))) {
    // The timeout bounds a daemon fork that keeps the pipes open.
    await $.process.run(argv, { timeoutMs: 5_000 }).catch(() => undefined)
    if (argv[0] === 'pueued') await waitUp($)
  }
  const path = await ownersFile($)
  if (path && ownerId) await $.fs.write(path, JSON.stringify(addOwner(await readOwners($, path), ownerId))).catch(() => undefined)
}

/** One idle check. `ending` is the session leaving now: its heartbeat is still fresh, so it is dropped by name. */
async function check($: EngineInterface, ending?: string) {
  const path = await ownersFile($)
  if (!path) return
  const before = await readOwners($, path)
  const daemon = await status($)
  const nowMs = await $.clock.now()
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const alive = freshIds(await $.fs.list(tmp).catch(() => []), nowMs).filter(id => id !== ending)
  const { state, shutdown } = idleCheck(before, daemon, alive, nowMs)
  if (JSON.stringify(state) !== JSON.stringify(before)) await $.fs.write(path, JSON.stringify(state)).catch(() => undefined)
  if (shutdown) await $.process.run(['pueue', 'shutdown']).catch(() => undefined)
}

// Called from register.tsx's session.start handler: the engine allows one session.start hook per module set.
export async function onSessionStart($: EngineInterface) {
  ownerId = await $.session.id().catch(() => undefined)
  await check($).catch(() => undefined)
  timer?.cancel()
  timer = $.clock.every(CHECK_MS, () => { void check($).catch(() => undefined) })
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.command.includes('pueue add')) await ensure($).catch(() => undefined)
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    // A /clear goes on in this process under the same heartbeat, so its owner stays.
    if (e.reason !== 'clear') await check($, ownerId ?? e.sessionId).catch(() => undefined)
    return next(e)
  })
}
