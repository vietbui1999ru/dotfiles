export type PueueState = 'Queued' | 'Running' | 'Paused' | 'Done' | 'Failed' | 'Killed' | 'Other'

export type Task = {
  id: number
  label?: string
  cwd: string
  group?: string
  state: PueueState
  exit?: number
  createdMs?: number
  enqueuedMs?: number
  startMs?: number
  endMs?: number
  command: string
}

type Record = { [key: string]: unknown }

const object = (value: unknown): Record | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record : undefined

const date = (value: unknown): number | undefined => {
  if (typeof value !== 'string') return undefined
  const ms = Date.parse(value)
  return Number.isNaN(ms) ? undefined : ms
}

const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined

const stateOf = (status: Record): Pick<Task, 'state' | 'exit'> => {
  if (status.Queued) return { state: 'Queued' }
  if (status.Running) return { state: 'Running' }
  if (status.Paused) return { state: 'Paused' }
  const done = object(status.Done)
  if (!done) return { state: 'Other' }
  const result = done.result
  if (result === 'Success') return { state: 'Done' }
  if (result === 'Killed') return { state: 'Killed' }
  const failed = object(result)?.Failed
  return { state: 'Failed', exit: number(failed) }
}

const times = (status: Record) => {
  const detail = Object.values(status).map(object).find(Boolean)
  return {
    enqueuedMs: date(detail?.enqueued_at),
    startMs: date(detail?.start),
    endMs: date(detail?.end),
  }
}

/** Parse only the stable pueue JSON fields; unknown states remain visible as Other. */
export const parseStatus = (json: string): Task[] => {
  try {
    const tasks = object(JSON.parse(json))?.tasks
    const rows = object(tasks)
    if (!rows) return []
    return Object.values(rows).flatMap(raw => {
      const task = object(raw)
      const id = number(task?.id)
      const cwd = typeof task?.path === 'string' ? task.path : undefined
      const command = typeof task?.command === 'string' ? task.command : undefined
      const status = object(task?.status)
      if (id === undefined || cwd === undefined || command === undefined || !status) return []
      return [{
        id,
        cwd,
        command,
        ...(typeof task.label === 'string' ? { label: task.label } : {}),
        ...(typeof task.group === 'string' ? { group: task.group } : {}),
        createdMs: date(task.created_at),
        ...stateOf(status),
        ...times(status),
      }]
    })
  } catch {
    return []
  }
}

// pueue executes a shell command. This deliberately accepts an absolute pi path too.
export const isPiDispatch = (command: string): boolean => /(?:^|[\s;&|])(?:\S*\/)?pi(?:\s|$)/.test(command) && /(?:^|\s)(?:-p|--prompt)(?:\s|=)/.test(command)

export const parseAddResult = (stdout: string): number | undefined => {
  const match = stdout.trim().match(/^(\d+)$/)
  return match ? Number(match[1]) : undefined
}

const words = (command: string): string[] => {
  const output: string[] = []
  let token = ''
  let quote: string | undefined
  let escape = false
  for (const char of command) {
    if (escape) { token += char; escape = false; continue }
    if (char === '\\' && quote !== "'") { escape = true; continue }
    if ((char === "'" || char === '"') && (!quote || quote === char)) { quote = quote ? undefined : char; continue }
    if (/\s/.test(char) && !quote) { if (token) output.push(token); token = ''; continue }
    token += char
  }
  if (token) output.push(token)
  return output
}

export type PiCommand = { model?: string; effort?: string; sessionId?: string; label?: string }

export const parsePiCommand = (command: string): PiCommand => {
  const argv = words(command)
  const pi = argv.findIndex(word => word === 'pi' || word.endsWith('/pi'))
  if (pi < 0) return {}
  const take = (flag: string) => {
    const index = argv.indexOf(flag, pi + 1)
    return index >= 0 ? argv[index + 1] : undefined
  }
  const rawModel = take('--model')
  const colon = rawModel?.lastIndexOf(':') ?? -1
  const model = rawModel && colon > rawModel.lastIndexOf('/') ? rawModel.slice(0, colon) : rawModel
  const modelEffort = rawModel && colon > rawModel.lastIndexOf('/') ? rawModel.slice(colon + 1) : undefined
  return {
    ...(model ? { model } : {}),
    ...(take('--thinking') ?? modelEffort ? { effort: take('--thinking') ?? modelEffort } : {}),
    ...(take('--session-id') ? { sessionId: take('--session-id') } : {}),
    ...(take('--label') ? { label: take('--label') } : {}),
  }
}

/**
 * A `--tui` dispatch runs interactive Pi in its own herdr pane, so the mod steers
 * that pane instead of starting a new run, and `pi-view` labels the task by it.
 */
export const isTuiDispatch = (command: string): boolean =>
  /(?:^|[\s;&|])\S*pi-view\s+--tui(?:\s|$)/.test(command)

/** pueue joins argv raw; dispatch must be supplied as this single, pre-quoted argument. */
export const dispatchCommand = (model: string, sessionId: string, promptPath: string): string =>
  `pi --model '${model.replace(/'/g, "'\\''")}' --session-id '${sessionId.replace(/'/g, "'\\''")}' -p "$(cat '${promptPath.replace(/'/g, "'\\''")}')" < /dev/null`
