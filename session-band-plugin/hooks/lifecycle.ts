// Pure rules for the pueue daemon's life: when Pi work needs it, who owns it, and when it may stop.
// No engine here; lifecycle.tsx does the I/O.
import { releaseArgv } from './controls'
import { parseStatus, type Task } from './pueue'

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
