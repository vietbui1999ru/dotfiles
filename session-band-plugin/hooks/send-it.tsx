import { atom, read, update, type CommandRunInput, type CommandRunResult, type EngineInterface, type Register } from 'claude-code'

import { acceptsOrigin, disable, enable, hasSendItBlock, isEligible, isOn, refusedRepos, SEND_IT_SINCE, sendItOn } from './send-it'

const LOG = '.claude/state/send-it.log'
const SETTINGS = '.claude/settings.local.json'
const CONFLICT_PREFIX = 'send-it: refused, these keys already hold other values:'
const RULE = '.claude/rules/send-it.md'
const MISSING_RULE = 'send-it is on but ~/.claude/rules/send-it.md is missing or unreadable; the mode runs without its rules.'
const REFUSED_CHANGE = 'send-it: this settings change is refused mid-session and applies at the next session start.'

// True while send-it runs in this session. Set at session start, read by the rule and the ConfigChange guard.
const sendItAtom = atom({ plugin: 'session-band', key: 'sendIt' } as const, false)

// Reads the repo's local settings as loaded and records whether send-it runs in this session.
export async function refreshSendIt($: EngineInterface): Promise<boolean> {
  const on = sendItOn(await $.settings.read({ source: 'local' }))
  await update($, sendItAtom, () => on)
  return on
}

// The local settings as they are on disk now: a mid-session edit is visible here, not in the loaded settings.
const onDiskLocalText = async ($: EngineInterface): Promise<string> => {
  const top = (await git($, ['rev-parse', '--show-toplevel'])).split('\n')[0] ?? ''
  return top ? $.fs.read(`${top}/${SETTINGS}`).catch(() => '') : ''
}

const git = async ($: EngineInterface, args: string[]): Promise<string> => {
  const r = await $.process.run(['git', ...args]).catch(() => undefined)
  return r?.exitCode === 0 ? r.stdout.trim() : ''
}

// Appends one line. A failed read skips the write, so an unreadable log is never overwritten.
const appendLog = async ($: EngineInterface, home: string, line: string) => {
  const path = `${home}/${LOG}`
  try {
    const prior = (await $.fs.exists(path)) ? await $.fs.read(path) : ''
    await $.fs.write(path, `${prior}${line}\n`)
  } catch { /* logging must not block the command */ }
}

const reply = async ($: EngineInterface, home: string, args: string, repo: string, result: string): Promise<CommandRunResult> => {
  await appendLog($, home, `${new Date(await $.clock.now()).toISOString()} /send-it ${args} ${repo} ${result}`)
  return { text: result }
}

const handle = async ($: EngineInterface, e: CommandRunInput): Promise<CommandRunResult> => {
  if (!acceptsOrigin(e.origin.kind)) return { text: 'send-it: refused, only the person can run /send-it at the composer' }
  const args = e.args.trim()
  if (!['on', 'off', 'status'].includes(args)) return { text: 'send-it: usage /send-it on|off|status' }
  const home = await $.env.get('HOME')
  if (!home) return { text: 'send-it: HOME is unset, not editing anything' }

  const [top, common] = (await git($, ['rev-parse', '--path-format=absolute', '--show-toplevel', '--git-common-dir'])).split('\n')
  if (!top || !common) return { text: 'send-it: not inside a git repo' }
  const root = (await git($, ['rev-list', '--max-parents=0', 'HEAD'])).split('\n')[0] ?? ''
  const rootDate = root ? await git($, ['show', '-s', '--format=%cI', root]) : ''

  if (!isEligible(common, rootDate, home)) {
    const why = refusedRepos(home).includes(common)
      ? 'this repo is on the refused list'
      : `its root commit is before ${SEND_IT_SINCE} or unreadable`
    return reply($, home, args, common, `send-it: refused, ${why}`)
  }

  const path = `${top}/${SETTINGS}`
  try {
    const text = (await $.fs.exists(path)) ? await $.fs.read(path) : '{}'
    if (args === 'status') return reply($, home, args, common, `send-it is ${isOn(text) ? 'on' : 'off'} for this repo`)
    await $.fs.write(path, args === 'on' ? enable(text) : disable(text))
  } catch (err) {
    // Only the conflict refusal is shown as-is: it names key paths, never values.
    // Any other error keeps the fixed text, since parse errors can quote the file.
    const msg = err instanceof Error ? err.message : ''
    if (msg.startsWith(CONFLICT_PREFIX)) return reply($, home, args, common, msg)
    return reply($, home, args, common, `send-it: ${SETTINGS} could not be read as a JSON object; not editing it`)
  }
  return reply($, home, args, common, 'written; restart to apply')
}

export const register: Register = on => {
  on('command.run', { command: 'send-it' }, async ($, e, _next) => handle($, e))

  // Settings changes are refused while send-it runs or its block sits in the repo; they apply at the next start.
  on('classic.ConfigChange', async ($, e, next) => {
    if (e.source !== 'local_settings' && e.source !== 'user_settings') return next(e)
    const guarded = await read($, sendItAtom) || hasSendItBlock(await onDiskLocalText($))
    return guarded ? { block: REFUSED_CHANGE } : next(e)
  })

  // The rule is injected only while send-it is on. Refreshing here too keeps it right whichever start hook runs first.
  on('classic.SessionStart', async ($, e, next) => {
    const result = await next(e)
    if (!(await refreshSendIt($))) return result
    const home = await $.env.get('HOME')
    const text = home ? await $.fs.read(`${home}/${RULE}`).catch(() => undefined) : undefined
    if (text === undefined) {
      $.ui.toast(MISSING_RULE, { timeoutMs: 15_000 })
      return { ...result, additionalContext: [...(result.additionalContext ?? []), MISSING_RULE] }
    }
    return { ...result, additionalContext: [...(result.additionalContext ?? []), text] }
  })
}
