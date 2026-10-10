import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import { dispatchCommand, parseAddResult, parseStatus } from './pueue'
import { selectStale, type TrackedTask } from './handoff'
import type { PiProgress } from './pisession'

const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [] as TrackedTask[], available: true })
const progress = atom({ plugin: 'session-band', key: 'progress' } as const, {} as Record<number, PiProgress>)
let aborting: number | undefined
let stale: ReturnType<typeof selectStale> | undefined
let continueCount = 0

const complete = (task: TrackedTask) => ['Done', 'Failed', 'Killed'].includes(task.task?.state ?? '')
const selected = (tasks: readonly TrackedTask[]) => tasks.find(task => !task.dismissed)
const taskLabel = (task: TrackedTask) => `pi#${task.id} ${task.task?.state ?? 'Other'}${task.label ? ` · ${task.label}` : ''}`

async function open($: EngineInterface) {
  await $.ui.open({ id: 'pi-handoff', title: 'Pi hand-off', focus: true })
}

export const controlArgv = (task: TrackedTask, action: 'kill' | 'pause' | 'start' | 'remove'): string[] | undefined =>
  action === 'remove' && !complete(task) ? undefined : ['pueue', action, String(task.id)]

async function control($: EngineInterface, task: TrackedTask, action: 'kill' | 'pause' | 'start' | 'remove') {
  const argv = controlArgv(task, action)
  if (argv) await $.process.run(argv)
}

async function dismiss($: EngineInterface, task: TrackedTask) {
  await update($, handoff, state => ({ ...state, tasks: state.tasks.map(item => item.id === task.id ? { ...item, dismissed: true } : item) }))
}

export const continueArgv = (task: TrackedTask, model: string, path: string): string[] =>
  ['pueue', 'add', '-i', '--print-task-id', '--label', task.label ?? `continue-${task.id}`, '--', dispatchCommand(model, task.sessionId ?? '', path)]

async function continueTask($: EngineInterface, task: TrackedTask, text: string) {
  if (!task.sessionId || text.trim() === '') return
  const tmp = await $.env.get('TMPDIR') ?? '/tmp'
  const slug = task.sessionId.replace(/[^A-Za-z0-9_-]/g, '-')
  const path = `${tmp.replace(/\/$/, '')}/pi-continue-${slug}-${++continueCount}.md`
  await $.fs.write(path, text)
  const model = task.task ? task.task.command.match(/--model\s+([^\s]+)/)?.[1] ?? 'opencode-go/deepseek-v4-flash:off' : 'opencode-go/deepseek-v4-flash:off'
  const label = task.label ?? `continue-${task.id}`
  const result = await $.process.run(continueArgv(task, model, path))
  const id = parseAddResult(result.stdout)
  if (id === undefined) return
  const status = await $.process.run(['pueue', 'status', '--json'])
  const queued = parseStatus(status.stdout).find(item => item.id === id)
  const addedMs = await $.clock.now()
  await update($, handoff, state => ({ ...state, tasks: [...state.tasks, { id, cwd: task.cwd, addedMs, task: queued, sessionId: task.sessionId, label }] }))
}

async function cleanStale($: EngineInterface) {
  if (stale) {
    for (const task of stale.tasks) await $.process.run(['pueue', 'remove', String(task.id)])
    for (const session of stale.sessions) await $.process.run(['rm', session.path])
    const ids = new Set(stale.tasks.map(task => task.id))
    await update($, handoff, state => ({ ...state, tasks: state.tasks.filter(task => !ids.has(task.id)) }))
    stale = undefined
    await $.ui.toast('Pi stale hand-offs removed')
    return
  }
  const state = await read($, handoff)
  const home = await $.env.get('HOME')
  const files = [] as { path: string; name: string; mtimeMs: number; size: number }[]
  if (home) {
    for (const task of state.tasks) {
      if (!task.sessionId?.startsWith('pueue-')) continue
      const dir = `${home}/.pi/agent/sessions/--${task.cwd.replace(/^\/+/, '').replaceAll('/', '-')}--`
      const listed = await $.fs.list(dir).catch(() => [])
      for (const file of listed) if (file.kind === 'file' && file.name.endsWith(`_${task.sessionId}.jsonl`)) files.push({ path: `${dir}/${file.name}`, name: file.name, mtimeMs: file.mtimeMs, size: file.size })
    }
  }
  stale = selectStale(state.tasks, files, await $.clock.now())
  await $.ui.toast(`Clean stale dry run: ${stale.tasks.length} tasks, ${stale.sessions.length} sessions, ${stale.bytes} B. Press again to remove.`)
}

export const register: Register = on => {
  on('command.run', { command: 'pi' }, async ($, _e, _next) => {
    await open($)
    return { text: 'Pi hand-off pane opened.' }
  })

  on('ui.render', { component: 'Pane', requestId: 'pi-handoff' }, async ($, e, _next) => {
    const { Box, Text, Button, Input } = $.ui.resolve(e)
    const [state, allProgress] = await Promise.all([read($, handoff), read($, progress)])
    const task = selected(state.tasks)
    const pi = task ? allProgress[task.id] : undefined
    const transcript = pi?.entries.slice(-200) ?? []
    return <Box flexDirection="column">
      <Text>{state.tasks.length === 0 ? 'No Pi hand-offs tracked in this session.' : state.tasks.map(taskLabel).join('\n')}</Text>
      {task && <Text>{`\n${taskLabel(task)}${pi?.lastActivity ? ` · ${pi.lastActivity}` : ''}\n${pi ? `${pi.tokens} tokens · $${pi.cost.toFixed(3)}` : 'usage n/a'}`}</Text>}
      {transcript.map((entry, index) => <Text key={`entry-${index}`}>{entry.kind === 'error' ? `ERROR ${entry.text}` : entry.text.slice(0, 280)}</Text>)}
      {task && <Box>
        <Button key="pi-abort" onPress={() => { if (aborting === task.id) { aborting = undefined; void control($, task, 'kill') } else { aborting = task.id; void $.ui.toast('Press Abort again to confirm.') } }}>Abort</Button>
        <Button key="pi-pause" onPress={() => void control($, task, task.task?.state === 'Paused' ? 'start' : 'pause')}>{task.task?.state === 'Paused' ? 'Resume' : 'Pause'}</Button>
        {complete(task) && <Button key="pi-remove" onPress={() => void control($, task, 'remove')}>Remove</Button>}
        <Button key="pi-dismiss" onPress={() => void dismiss($, task)}>Dismiss</Button>
      </Box>}
      {task && <Input key="pi-continue" label="Continue" placeholder="Follow-up for Pi" submitLabel="send" onSubmit={value => void continueTask($, task, value)} />}
      <Button key="pi-clean-stale" onPress={() => void cleanStale($)}>Clean stale</Button>
    </Box>
  })
}
