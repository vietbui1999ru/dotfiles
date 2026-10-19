import { type EngineInterface, type Register } from 'claude-code'

import { daemonState, ensureArgvs } from './lifecycle'

const status = async ($: EngineInterface) => {
  const result = await $.process.run(['pueue', 'status', '--json']).catch(() => undefined)
  return daemonState(result?.exitCode ?? 1, result?.stdout ?? '')
}

/** `pueued -d` forks and may return before the socket is up; wait up to two seconds for it. */
async function waitUp($: EngineInterface) {
  for (let tries = 0; tries < 10; tries += 1) {
    if ((await status($)).kind === 'up') return
    await $.clock.sleep(200)
  }
}

/** Before a dispatch: start the daemon and the group when the task would not run. */
async function ensure($: EngineInterface) {
  for (const argv of ensureArgvs(await status($))) {
    // The timeout bounds a daemon fork that keeps the pipes open.
    await $.process.run(argv, { timeoutMs: 5_000 }).catch(() => undefined)
    if (argv[0] === 'pueued') await waitUp($)
  }
}

export const register: Register = on => {
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    if (e.command.includes('pueue add')) await ensure($).catch(() => undefined)
    return next(e)
  })
}
