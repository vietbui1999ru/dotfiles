// Pure rules for the pueue daemon's life: when Pi work needs it, who owns it, and when it may stop.
// No engine here; lifecycle.tsx does the I/O.
import { releaseArgv } from './controls'
import { parseStatus, type PueueState, type Task } from './pueue'
import { countChanges } from './worktrees'

export type Daemon = { kind: 'down' } | { kind: 'up'; group: 'running' | 'paused' | 'zero'; tasks: Task[] }

type Group = { status?: unknown; parallel_tasks?: unknown }

/** One `pueue status --json` call, read as daemon and group state. A failed or unreadable call is down. */
export const daemonState = (exitCode: number, stdout: string, group = 'default'): Daemon => {
  if (exitCode !== 0) return { kind: 'down' }
  let groups: Record<string, Group | undefined> | undefined
  try { groups = (JSON.parse(stdout) as { groups?: Record<string, Group | undefined> } | null)?.groups } catch { return { kind: 'down' } }
  const own = groups?.[group]
  const state = own?.parallel_tasks === 0 ? 'zero' : own?.status === 'Paused' ? 'paused' : 'running'
  return { kind: 'up', group: state, tasks: parseStatus(stdout) }
}

/** Daemon down, group paused and zero workers are one state: queued work will not start. */
export const isNotRunning = (daemon: Daemon): boolean => daemon.kind === 'down' || daemon.group !== 'running'

export const liveCount = (tasks: readonly Task[]): number =>
  tasks.filter(task => task.state === 'Queued' || task.state === 'Running' || task.state === 'Paused').length

/** The band's one word on the queue: "held N" for a stopped group holding work, else "not running" while this session has work waiting. */
export const queueBadge = (daemon: Daemon, hasWork: boolean): string | undefined => {
  const live = daemon.kind === 'up' ? liveCount(daemon.tasks) : 0
  if (daemon.kind === 'up' && daemon.group === 'paused' && live > 0) return `held ${live}`
  return hasWork && isNotRunning(daemon) ? 'not running' : undefined
}

/** What runs before a dispatch so the task can start: the daemon if down, then the group. */
export const ensureArgvs = (daemon: Daemon, group = 'default'): string[][] =>
  daemon.kind === 'down' ? [['pueued', '-d'], releaseArgv(group)] : daemon.group === 'running' ? [] : [releaseArgv(group)]

/** Edit re-adds a task with a new model and label, so only a task pueue has not started may change. */
export const editRefusal = (state: PueueState | undefined): string | undefined =>
  state === 'Queued' ? undefined : `Edit refused: the task is ${state ?? 'gone from pueue'}; only a queued task can be edited.`

/** `model[:effort] [label…]`, as typed in the pane's Edit input. */
export const parseEdit = (text: string): { model: string; label?: string } | undefined => {
  const [model, ...label] = text.trim().split(/\s+/).filter(Boolean)
  return model ? { model, ...(label.length ? { label: label.join(' ') } : {}) } : undefined
}

const quote = (value: string) => `'${value.replace(/'/g, "'\\''")}'`

/** The task's own command with only `--model` replaced; prompt, session id and redirects stay as dispatched. */
export const withModel = (command: string, model: string): string =>
  command.replace(/--model\s+(?:'[^']*'|"[^"]*"|\S+)/, () => `--model ${quote(model)}`)

export const readdArgv = (task: Task, model: string, label: string): string[] =>
  ['pueue', 'add', '--print-task-id', '--label', label, '--group', task.group ?? 'default', '--', withModel(task.command, model)]

/** A kill never reverts the worktree, so the reply says how much it holds uncommitted. */
export const killNote = (cwd: string, porcelain: string): string => {
  const count = countChanges(porcelain)
  return ` ${cwd} holds ${count} uncommitted change${count === 1 ? '' : 's'}; nothing was reverted.`
}

export const IDLE_MS = 15 * 60_000
/** The heartbeat (heartbeat.ts) rewrites every 15 s; one older than this belongs to a session that is gone. */
export const OWNER_FRESH_MS = 60_000

/** The owners file: sessions that dispatched Pi work, and when the queue was last seen empty. */
export type Owners = { owners: string[]; emptySinceMs?: number }

export const ownersPath = (stateHome: string | undefined, home: string): string =>
  `${(stateHome || `${home}/.local/state`).replace(/\/$/, '')}/session-band/pueue-owners.json`

export const parseOwners = (text: string): Owners => {
  try {
    const value = JSON.parse(text) as { owners?: unknown; emptySinceMs?: unknown } | null
    const raw = value?.owners
    const owners = Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string') : []
    const since = value?.emptySinceMs
    return typeof since === 'number' ? { owners, emptySinceMs: since } : { owners }
  } catch { return { owners: [] } }
}

/** A dispatch adds its session and restarts the idle window, so a stale emptySinceMs cannot stop a fresh queue. */
export const addOwner = (state: Owners, id: string): Owners =>
  ({ owners: state.owners.includes(id) ? state.owners : [...state.owners, id] })

/** Session ids whose heartbeat file is fresh: the live sessions. */
export const freshIds = (entries: readonly { name: string; mtimeMs: number }[], nowMs: number): string[] =>
  entries.flatMap(entry => {
    const id = /^session-band-(.+)\.alive$/.exec(entry.name)?.[1]
    return id && nowMs - entry.mtimeMs < OWNER_FRESH_MS ? [id] : []
  })

export type Check = { state: Owners; shutdown: boolean }

/** One check: drop dead owners, track when the queue emptied, stop only with no owner, no live task and 15 idle minutes. */
export const idleCheck = (state: Owners, daemon: Daemon, alive: readonly string[], nowMs: number): Check => {
  const owners = state.owners.filter(id => alive.includes(id))
  if (daemon.kind === 'down' || liveCount(daemon.tasks) > 0) return { state: { owners }, shutdown: false }
  const emptySinceMs = state.emptySinceMs ?? nowMs
  return { state: { owners, emptySinceMs }, shutdown: owners.length === 0 && nowMs - emptySinceMs >= IDLE_MS }
}
