import type { CommandRunInput, CommandRunResult, EngineInterface, Register } from 'claude-code'

import { acceptsOrigin, disable, enable, isEligible, isOn, refusedRepos, SEND_IT_SINCE } from './send-it'

const LOG = '.claude/state/send-it.log'
const SETTINGS = '.claude/settings.local.json'

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
  } catch {
    // Fixed text: the parse error can quote the file, and the file holds env values.
    return reply($, home, args, common, `send-it: ${SETTINGS} could not be read as a JSON object; not editing it`)
  }
  return reply($, home, args, common, 'written; restart to apply')
}

export const register: Register = on => {
  on('command.run', { command: 'send-it' }, async ($, e, _next) => handle($, e))
}
