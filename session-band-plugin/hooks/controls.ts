import type { TrackedTask } from './handoff'
import { isPiDispatch, type PueueState, type Task } from './pueue'

export type ControlAction = 'kill' | 'pause' | 'resume' | 'rm' | 'hold' | 'release'
export type PiArgs =
  | { kind: 'open' }
  | { kind: 'control'; action: ControlAction; target: 'selected' | 'all' | number[] }
  | { kind: 'error'; text: string }
export type Targets = { ids: number[]; refused: { id: number; reason: string }[] }

export const PI_USAGE = 'usage: /pi [kill|pause|resume|rm|hold] [ids|all], /pi release'
const ACTIONS: readonly ControlAction[] = ['kill', 'pause', 'resume', 'rm', 'hold', 'release']
const live = (state: PueueState) => state === 'Running' || state === 'Queued' || state === 'Paused'

export const parsePiArgs = (args: string): PiArgs => {
  const [verb, ...rest] = args.trim().split(/\s+/).filter(Boolean)
  if (!verb) return { kind: 'open' }
  const action = ACTIONS.find(item => item === verb)
  if (!action) return { kind: 'error', text: `unknown action "${verb}"; ${PI_USAGE}` }
  if (action === 'release') return { kind: 'control', action, target: 'all' }
  if (rest.length === 0) return { kind: 'control', action, target: 'selected' }
  if (rest.length === 1 && rest[0] === 'all') return { kind: 'control', action, target: 'all' }
  const ids = rest.map(word => /^#?\d+$/.test(word) ? Number(word.replace('#', '')) : Number.NaN)
  if (ids.some(Number.isNaN)) return { kind: 'error', text: `ids must be numbers; ${PI_USAGE}` }
  return { kind: 'control', action, target: [...new Set(ids)] }
}

export const eligible = (action: ControlAction, state: PueueState): boolean => {
  if (action === 'pause') return state === 'Running' || state === 'Queued'
  if (action === 'resume') return state === 'Paused'
  if (action === 'rm') return state === 'Done' || state === 'Failed' || state === 'Killed'
  return live(state)
}

export const resolveTargets = (
  action: ControlAction,
  target: 'selected' | 'all' | number[],
  tracked: readonly TrackedTask[],
  pueue: readonly Task[],
  selectedId?: number,
): Targets => {
  const byId = new Map(pueue.map(task => [task.id, task]))
  const wanted = target === 'all'
    ? tracked.filter(item => !item.dismissed).map(item => item.id)
    : target === 'selected' ? (selectedId === undefined ? [] : [selectedId]) : target
  const result: Targets = { ids: [], refused: [] }
  for (const id of wanted) {
    const task = byId.get(id)
    if (!task) result.refused.push({ id, reason: 'not in pueue' })
    else if (!isPiDispatch(task.command)) result.refused.push({ id, reason: 'not a Pi hand-off' })
    else if (!eligible(action, task.state)) result.refused.push({ id, reason: task.state })
    else result.ids.push(id)
  }
  // `all` reports only what it acts on: finished tasks are expected there, not refusals.
  return target === 'all' ? { ids: result.ids, refused: [] } : result
}

const nonEmpty = (ids: readonly number[]) => {
  if (ids.length === 0) throw new Error('refusing a pueue command with no ids: it would act on the whole group')
  return ids.map(String)
}

export const controlArgv = (action: Exclude<ControlAction, 'hold' | 'release'>, ids: readonly number[]): string[] =>
  ['pueue', { kill: 'kill', pause: 'pause', resume: 'start', rm: 'remove' }[action], ...nonEmpty(ids)]

/** Stops the group starting queued tasks; its running tasks keep running. */
export const holdArgv = (group: string): string[] => ['pueue', 'pause', '--group', group, '--wait']

/** `pueue kill` cannot stop a Queued task (it exits 1 and leaves it queued), so a queued one is removed. */
export const stopArgvs = (ids: readonly number[], states: ReadonlyMap<number, PueueState>): string[][] => {
  const queued = ids.filter(id => states.get(id) === 'Queued')
  const started = ids.filter(id => states.get(id) !== 'Queued')
  return [...(started.length ? [controlArgv('kill', started)] : []), ...(queued.length ? [controlArgv('rm', queued)] : [])]
}

export const releaseArgv = (group: string): string[] => ['pueue', 'start', '--group', group]

/** Every process with its parent and group; `-ww` keeps long commands whole so they match pueue's. */
export const PS_ARGV = ['ps', '-A', '-ww', '-o', 'pid=,ppid=,pgid=,command=']

/**
 * Process groups under a task's tree other than the task's own group. pueue runs each task as
 * `sh -c <command>` in a group of its own and `pueue kill` SIGKILLs that group, so Pi never gets
 * to reap the bash tools it ran detached; they would outlive the kill unless killed by group.
 */
export const strayGroups = (ps: string, commands: readonly string[]): number[] => {
  const rows = ps.split('\n').flatMap(line => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\d+)\s(.*)$/.exec(line)
    return match ? [{ pid: Number(match[1]), ppid: Number(match[2]), pgid: Number(match[3]), command: match[4]! }] : []
  })
  const groups = new Set<number>()
  for (const root of rows.filter(row => commands.some(command => row.command === `sh -c ${command}`))) {
    // Repeat until nothing joins: pids wrap, so a child can sort before its parent.
    const tree = new Set([root.pid])
    for (let size = 0; size !== tree.size;) {
      size = tree.size
      for (const row of rows) if (tree.has(row.ppid)) tree.add(row.pid)
    }
    for (const row of rows) if (tree.has(row.pid) && row.pgid !== root.pgid) groups.add(row.pgid)
  }
  return [...groups].sort((a, b) => a - b)
}

export const killGroupArgv = (pgid: number): string[] => ['/bin/kill', '-KILL', '--', `-${pgid}`]
