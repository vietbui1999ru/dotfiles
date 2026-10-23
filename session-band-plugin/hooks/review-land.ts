import { atom, read, update, type EngineInterface } from 'claude-code'

import { parseStatus } from './pueue'
import { appendEntry, type ThreadEntry } from './review-thread'

// This session's own turn, so landing a patch into its worktree waits for it to stop writing.
export const turn = atom({ plugin: 'session-band', key: 'review-turn' } as const, { started: false } as { started: boolean })

/** The trailer an overruled patch's commit carries: the agent's warning, cut to 200 characters. */
export const overruleTrailer = (clapbackText: string): string => `Overruled: agent warned "${clapbackText.slice(0, 200)}"`

const sessionIdIn = (command: string): string | undefined => {
  const match = /(?:^|\s)--session-id(?:=|\s+)(?:'([^']*)'|"([^"]*)"|(\S+))/.exec(command)
  return match?.[1] ?? match?.[2] ?? match?.[3]
}

// The same matching plan C's delivery uses: the session id in the command, or a label naming it.
async function piRunning($: EngineInterface, sessionId: string): Promise<boolean> {
  const status = await $.process.run(['pueue', 'status', '--json']).catch(() => undefined)
  if (!status || status.exitCode !== 0) return false
  return parseStatus(status.stdout).some(task =>
    task.state === 'Running' && (sessionIdIn(task.command) === sessionId || (task.label ?? '').includes(sessionId)))
}

type AgentRow = { sessionId?: unknown; state?: unknown; status?: unknown }

async function claudeBusy($: EngineInterface, sessionId: string): Promise<boolean> {
  // The test body's $ carries no session: an absent id simply matches this session less often.
  let own = ''
  try {
    own = await $.session.id()
  } catch {
    own = ''
  }
  if (sessionId === own) return (await read($, turn)).started
  const listed = await $.process.run(['claude', 'agents', '--json']).catch(() => undefined)
  if (!listed || listed.exitCode !== 0) return false
  try {
    const rows: unknown = JSON.parse(listed.stdout)
    if (!Array.isArray(rows)) return false
    return rows.some((row: AgentRow) => row !== null && typeof row === 'object'
      && row.sessionId === sessionId && (row.state === 'working' || row.status === 'working'))
  } catch {
    return false
  }
}

/** Whether the agent that owns this entry is mid-turn: landing then would collide with its writes. */
export async function agentBusy($: EngineInterface, agent: string): Promise<boolean> {
  if (agent.startsWith('pi:')) return piRunning($, agent.slice('pi:'.length))
  if (agent.startsWith('claude:')) return claudeBusy($, agent.slice('claude:'.length))
  return false
}

const systemEntry = (entry: ThreadEntry, text: string, at: string, replyTo?: string): ThreadEntry => ({
  id: crypto.randomUUID(),
  at,
  agent: entry.agent,
  file: entry.file,
  kind: 'system',
  author: 'pane',
  text,
  ...(replyTo === undefined ? {} : { replyTo }),
})

/**
 * Applies one agreed or overruled patch to the worktree and commits only its file through the
 * commit funnel. A busy owning agent makes it wait; a patch git refuses is reported in the thread
 * as `patch no longer applies` and stays proposed. Never forced, never reverted.
 */
export async function landPatch($: EngineInterface, worktree: string, entry: ThreadEntry, overruled?: ThreadEntry): Promise<'landed' | 'conflict' | 'waiting'> {
  const patch = entry.patch ?? ''
  if (patch.trim() === '') return 'conflict'
  if (await agentBusy($, entry.agent)) return 'waiting'

  const at = new Date(await $.clock.now()).toISOString()
  const conflict = async () => {
    await appendEntry($, worktree, systemEntry(entry, 'patch no longer applies', at, entry.id))
    return 'conflict' as const
  }
  const check = await $.process.run(['git', '-C', worktree, 'apply', '--check'], { stdin: patch }).catch(() => undefined)
  if (!check || check.exitCode !== 0) return conflict()
  const applied = await $.process.run(['git', '-C', worktree, 'apply'], { stdin: patch }).catch(() => undefined)
  if (!applied || applied.exitCode !== 0) return conflict()

  const now = at
  const trailer = overruled === undefined ? undefined : overruleTrailer(overruled.text)
  if (trailer !== undefined && overruled !== undefined) {
    await appendEntry($, worktree, {
      id: crypto.randomUUID(),
      at: now,
      agent: entry.agent,
      file: entry.file,
      kind: 'overrule',
      author: 'person',
      text: trailer,
      replyTo: overruled.id,
    })
  }

  const home = await $.env.get('HOME')
  const refused = async (why: string) => appendEntry($, worktree, systemEntry(entry, `patch landed; commit refused: ${why}`, now, entry.id))
  if (!home) {
    await refused('HOME is unset')
    return 'landed'
  }
  const tmp = ((await $.env.get('TMPDIR')) ?? '/tmp').replace(/\/+$/, '')
  const messagePath = `${tmp}/review-commit-${crypto.randomUUID()}.txt`
  const message = [`review: apply ${overruled === undefined ? 'agreed' : 'overruled'} patch to ${entry.file}`, ...(trailer === undefined ? [] : ['', trailer]), ''].join('\n')
  await $.fs.write(messagePath, message)
  const committed = await $.process.run([
    `${home}/dotfiles/scripts/commit-funnel`,
    '--worktree', worktree,
    '-F', messagePath,
    entry.file,
  ], { cwd: worktree, timeoutMs: 120_000 }).catch(() => undefined)
  if (!committed || committed.exitCode !== 0) {
    await refused((committed?.stderr.trim() || committed?.stdout.trim() || 'commit-funnel unavailable').split('\n')[0] ?? 'commit-funnel unavailable')
    return 'landed'
  }
  await appendEntry($, worktree, systemEntry(entry, 'patch landed', now, entry.id))
  return 'landed'
}

/**
 * This session's own turn, set by the one `turn.start`/`turn.complete` hook pair in register.tsx:
 * the atom lives here so the scan can read and write it in this module's function.
 */
export async function setTurn($: EngineInterface, started: boolean): Promise<void> {
  await update($, turn, () => ({ started }))
}
