import { atom, read, update, type EngineInterface, type Register } from 'claude-code'

import type { HistoryState, PiProgress } from '../types'
import { finalMessage, historyRowsPage, type HistoryFilter, type HistoryUsage, truncateCommand } from './history'
import { emptyProgress, fold, sessionDir, sessionFileName } from './pisession'
import { isPiDispatch, parsePiCommand, parseStatus, type Task } from './pueue'
import { PALETTE } from './palette'
import { parsePending, pendingRecordFor, reviewState, type PendingReview, type ReviewState } from './review'
import type { HandoffState } from './handoff.tsx'

const history = atom({ plugin: 'session-band', key: 'history' } as const, {
  tasks: [], reviews: {}, usage: {}, filter: 'all', limit: 50, open: false, available: true,
} satisfies HistoryState)
const handoff = atom({ plugin: 'session-band', key: 'handoff' } as const, { tasks: [], available: true } satisfies HandoffState)
let timer: { cancel(): void } | undefined
let refreshing = false

export const HISTORY_LEGEND = '✓ success · ✓ review pending · ✗ exit · ✗ killed'
const pageSize = 50
const finishedPi = (task: Task) => isPiDispatch(task.command) && ['Done', 'Failed', 'Killed'].includes(task.state)
const usageKey = (task: Task, sessionId: string) => `${task.cwd}\u0000${sessionId}`
const resultText = (task: Task) => {
  if (task.state === 'Killed') return 'killed'
  if (task.state === 'Failed') return `exit ${task.exit ?? '?'}`
  return 'success'
}

const historyText = (row: ReturnType<typeof historyRowsPage>[number], columns: number): string => {
  const fields: { name?: 'repo' | 'usage' | 'model'; text: string }[] = [
    { text: row.style.result }, { text: `#${row.task.id}` }, { text: row.label },
    ...(row.modelEffort ? [{ name: 'model' as const, text: row.modelEffort }] : []),
    { text: row.duration }, { text: row.finished }, { name: 'repo', text: row.repo }, { name: 'usage', text: row.usage },
    ...(row.review ? [{ text: row.review }] : []),
  ]
  const joined = () => fields.map(field => field.text).join(' · ')
  for (const name of ['repo', 'usage', 'model'] as const) {
    if (joined().length <= columns) break
    const index = fields.findIndex(field => field.name === name)
    if (index >= 0) fields.splice(index, 1)
  }
  return joined()
}

async function reviewRoot($: EngineInterface, cwd: string): Promise<string> {
  const result = await $.process.run(['git', '-C', cwd, 'rev-parse', '--show-toplevel']).catch(() => undefined)
  return result?.exitCode === 0 && result.stdout.trim() ? result.stdout.trim() : cwd
}

async function reviewFor($: EngineInterface, task: Task, tracked: HandoffState['tasks'][number] | undefined): Promise<ReviewState> {
  const root = `${await reviewRoot($, task.cwd)}/.pi/agent-review`
  const files = await $.fs.list(`${root}/pending`).catch(() => [])
  const records: PendingReview[] = []
  for (const file of files) {
    if (file.kind !== 'file') continue
    const match = file.name.match(/^(.+)\.(json|processing)$/)
    if (!match) continue
    const runId = match[1]
    const parsed = parsePending(await $.fs.read(`${root}/pending/${file.name}`).catch(() => ''))
    if (parsed) records.push(parsed)
    else if (match[2] === 'processing' && runId) records.push({ runId, files: [] })
  }
  const current = pendingRecordFor(tracked ?? { task }, records)
  const runId = tracked?.runId ?? current?.runId
  let decision: unknown
  if (runId) {
    try { decision = JSON.parse(await $.fs.read(`${root}/decisions/${runId}.json`)) } catch { /* absent decisions are normal */ }
  }
  return reviewState(current, decision)
}

async function refresh($: EngineInterface) {
  if (refreshing || !(await read($, history)).open) return
  refreshing = true
  try {
    const result = await $.process.run(['pueue', 'status', '--json'])
    if (result.exitCode !== 0) {
      await update($, history, state => ({ ...state, available: false }))
      return
    }
    const tasks = parseStatus(result.stdout).filter(finishedPi)
    const tracked = await read($, handoff)
    const trackedById = new Map(tracked.tasks.map(task => [task.id, task]))
    const reviews = Object.fromEntries(await Promise.all(tasks.map(async task => [task.id, await reviewFor($, task, trackedById.get(task.id))] as const)))
    await update($, history, state => ({ ...state, tasks, reviews, available: true }))
  } finally {
    refreshing = false
  }
}

async function syncTimer($: EngineInterface) {
  const open = (await read($, history)).open
  if (open && !timer) timer = $.clock.every(10_000, () => { void refresh($) })
  if (!open && timer) { timer.cancel(); timer = undefined }
}

const sessionUsage = (task: Task, cache: HistoryState['usage']): HistoryUsage | undefined => {
  const sessionId = parsePiCommand(task.command).sessionId
  if (!sessionId) return undefined
  const entry = cache[usageKey(task, sessionId)]
  return entry ? { tokens: entry.tokens, cost: entry.cost, loading: entry.loading, available: entry.available } : { loading: true }
}

const finalMessageLabel = (cache: HistoryState['usage'][string] | undefined): string => {
  if (cache?.loading) return '…'
  return cache?.tail ? finalMessage(cache.tail) ?? 'n/a' : 'n/a'
}

export const tailChunkArgv = (path: string, offset: number): string[] =>
  ['sh', '-c', 'tail -c "+$1" "$2" | head -c 1048576', 'pi-history-tail', String(offset + 1), path]

async function loadUsage($: EngineInterface, task: Task) {
  const sessionId = parsePiCommand(task.command).sessionId
  if (!sessionId) return
  const key = usageKey(task, sessionId)
  const current = (await read($, history)).usage[key]
  if (current?.loading) return
  await update($, history, state => ({ ...state, usage: { ...state.usage, [key]: { ...state.usage[key], loading: true } } }))
  try {
    const home = await $.env.get('HOME')
    if (!home) throw new Error('HOME unavailable')
    const directory = `${home}/.pi/agent/sessions/${sessionDir(task.cwd)}`
    const files = await $.fs.list(directory)
    const file = files.find(item => item.kind === 'file' && sessionFileName(sessionId).test(item.name))
    if (!file) throw new Error('session file unavailable')
    const path = `${directory}/${file.name}`
    const stat = await $.fs.stat(path)
    if (current?.path === path && current.size === stat.size && current.mtimeMs === stat.mtimeMs) {
      await update($, history, state => ({ ...state, usage: { ...state.usage, [key]: { ...current, loading: false } } }))
      return
    }
    let offset = 0
    let progress: PiProgress = emptyProgress()
    let tail = ''
    while (offset < stat.size) {
      const result = await $.process.run(tailChunkArgv(path, offset))
      if (result.exitCode !== 0 || result.stdout.length === 0) break
      progress = fold(progress, result.stdout)
      tail = `${tail}${result.stdout}`.slice(-1_048_576)
      offset += new TextEncoder().encode(result.stdout).byteLength
    }
    await update($, history, state => ({
      ...state,
      usage: { ...state.usage, [key]: { path, size: stat.size, mtimeMs: stat.mtimeMs, tokens: progress.tokens, cost: progress.cost, tail, loading: false, available: true } },
    }))
  } catch {
    await update($, history, state => ({ ...state, usage: { ...state.usage, [key]: { ...state.usage[key], loading: false, available: false } } }))
  }
}

export const register: Register = on => {
  on('command.run', { command: 'pi-history' }, async ($, _e, _next) => {
    await $.ui.open({ id: 'pi-history', title: 'Pi history', focus: true })
    return { text: 'Pi history opened.' }
  })

  on('ui.open', async ($, e, next) => {
    const result = await next(e)
    if (e.id === 'pi-history') {
      await update($, history, state => ({ ...state, open: true }))
      await refresh($)
      await syncTimer($)
    }
    return result
  })

  on('ui.close', async ($, e, next) => {
    const result = await next(e)
    if (e.id === 'pi-history' && !('deny' in result)) {
      await update($, history, state => ({ ...state, open: false }))
      await syncTimer($)
    }
    return result
  })

  on('ui.render', { component: 'Pane', requestId: 'pi-history' }, async ($, e, _next) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const [state, nowMs] = await Promise.all([read($, history), $.clock.now()])
    const selected = state.selectedId
    const usage = Object.fromEntries(state.tasks.map(task => [task.id, sessionUsage(task, state.usage)]))
    const rows = historyRowsPage(state.tasks, state.reviews, usage, nowMs, state.filter, state.limit)
    const task = rows.find(row => row.task.id === selected)?.task ?? rows[0]?.task
    const selectedSession = task ? parsePiCommand(task.command).sessionId : undefined
    const selectedCache = task && selectedSession ? state.usage[usageKey(task, selectedSession)] : undefined
    for (const row of rows) void loadUsage($, row.task)
    if (task && !rows.some(row => row.task.id === task.id)) void loadUsage($, task)
    const filters: HistoryFilter[] = ['all', 'done', 'failed', 'killed']
    return <Box flexDirection="column">
      <Text>Pi history</Text>
      <Box><Text color={PALETTE.green}>✓ success</Text><Text color={PALETTE.yellow}> · ✓ review pending</Text><Text color={PALETTE.red}> · ✗ exit</Text><Text color={PALETTE.mauve}> · ✗ killed</Text></Box>
      <Box>{filters.map(filter => <Button key={`pi-history-${filter}`} plain label={filter === state.filter ? `[${filter}]` : filter} onPress={() => void update($, history, value => ({ ...value, filter, limit: pageSize }))} />)}</Box>
      {!state.available && <Text color={PALETTE.red}>pueue daemon unavailable</Text>}
      {rows.length === 0 && <Text>No completed Pi hand-offs in the last 7 days.</Text>}
      {rows.map(row => <Box key={`pi-history-row-${row.task.id}`} flexDirection="row">
        <Text color={PALETTE[row.style.tone]}>{row.style.glyph}</Text>
        <Button key={`pi-hist-${row.task.id}`} plain label={` ${row.task.id === task?.id ? '› ' : '  '}${historyText(row, Math.max(1, e.props.bodyColumns - 4))}`} onPress={() => void update($, history, value => ({ ...value, selectedId: row.task.id }))} />
      </Box>)}
      {rows.length === state.limit && <Button key="pi-history-older" onPress={() => void update($, history, value => ({ ...value, limit: value.limit + pageSize }))}>show older</Button>}
      {task && <Box flexDirection="column">
        <Text>{`\nStart: ${task.startMs ? new Date(task.startMs).toISOString() : 'n/a'}\nEnd: ${task.endMs ? new Date(task.endMs).toISOString() : 'n/a'}\nResult: ${resultText(task)}\nWorking directory: ${task.cwd}\nModel: ${[parsePiCommand(task.command).model, parsePiCommand(task.command).effort].filter(Boolean).join(':') || 'n/a'}\nLabel: ${task.label ?? 'n/a'}\nCommand: ${truncateCommand(task.command)}`}</Text>
        <Text>{`Final message:\n${finalMessageLabel(selectedCache)}`}</Text>
      </Box>}
    </Box>
  })
}

