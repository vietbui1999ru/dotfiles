import type { On } from 'claude-code'
import { mock, type TestBody } from 'claude-code/testing'

type Kit = Parameters<TestBody>

export const running = (id: number, nowMs: number) => {
  const at = new Date(nowMs).toISOString()
  return {
    id, label: `sim-${id}`, path: '/work', created_at: at, group: 'default',
    command: `pi --model opencode-go/flash:high --session-id pueue-sim-${id} -p 'x' < /dev/null`,
    status: { Running: { enqueued_at: at, start: at } },
  }
}

export const finished = (task: ReturnType<typeof running>, result: 'Success' | 'Killed' | { Failed: number }, nowMs: number) => {
  const at = new Date(nowMs).toISOString()
  // SAFETY: the fake builds pueue's raw JSON shape, whose Done.status differs from the running literal's type.
  return { ...task, status: { Done: { enqueued_at: at, start: task.created_at, end: at, result } } } as unknown as ReturnType<typeof running>
}

export const dispatch = '"pi --model opencode-go/flash:high --session-id pueue-sim -p x < /dev/null"'

// A fake pueue beneath the plugin. Setting `armed` freezes the next `pueue status` call with the
// snapshot it would have returned at that moment, until `release` lets it answer; `reached` resolves once it is held.
// `calls` records every non-status pueue argv after the program name, and those commands change the fake state.
export const fakePueue = (on: On, nowMs: () => number) => {
  const tasks: Record<string, ReturnType<typeof running>> = {}
  const calls: string[][] = []
  let reached: () => void = () => undefined
  const gate = {
    armed: false,
    release: undefined as (() => void) | undefined,
    reached: new Promise<void>(resolve => { reached = resolve }),
  }
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 1 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.root', () => ({ value: '/work' }))
  on('process.run', async (_$, e) => {
    if (e.argv[0] === 'pueue' && e.argv[1] !== 'status') {
      calls.push(e.argv.slice(1))
      const ids = e.argv.slice(2).filter(word => /^\d+$/.test(word))
      for (const id of ids) {
        const task = tasks[id]
        if (!task) continue
        const at = new Date(nowMs()).toISOString()
        if (e.argv[1] === 'kill') tasks[id] = { ...task, status: { Done: { enqueued_at: at, start: at, end: at, result: 'Killed' } } } as never
        if (e.argv[1] === 'pause') tasks[id] = { ...task, status: { Paused: { enqueued_at: at, start: at } } } as never
        if (e.argv[1] === 'start') tasks[id] = { ...task, status: { Running: { enqueued_at: at, start: at } } } as never
        if (e.argv[1] === 'remove') delete tasks[id]
      }
      return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
    }
    if (e.argv[0] !== 'pueue' || e.argv[1] !== 'status') return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
    const stdout = JSON.stringify({ tasks: { ...tasks } })
    if (gate.armed) {
      gate.armed = false
      reached()
      await new Promise<void>(resolve => { gate.release = resolve })
    }
    return { value: { exitCode: 0, stdout, stderr: '' } } as never
  })
  on('tool.call', (_$, e) => {
    if (e.tool !== 'Bash') return { result: {} } as never
    const id = Object.keys(tasks).length + 1
    tasks[id] = running(id, nowMs())
    return { result: 'ok', text: String(id) } as never
  })
  return Object.assign(gate, { tasks, calls })
}

export const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'pi-handoff',
  props: { title: 'Pi hand-off', isFocused: true, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

// The drawn text, Button labels included.
export const text = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const value = node as { children?: unknown[]; props?: { children?: unknown; label?: unknown } }
  const own = typeof value.props?.label === 'string' ? value.props.label : ''
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  return `${own}${children.map(text).join('')}\n`
}

/** Mocked clock and env, toast/open stubs, a fake pueue, and `count` tracked Pi hand-offs (#1..#count, Running). */
export const setupTracked = async ($: Kit[0], on: Kit[1], count = 1) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', () => ({ value: undefined } as never))
  const pueue = fakePueue(on, clock.now)
  for (let added = 0; added < count; added += 1) await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  pueue.calls.length = 0
  return { clock, pueue }
}
