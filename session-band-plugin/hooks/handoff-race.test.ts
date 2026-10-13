import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'pi-handoff',
  props: { title: 'Pi hand-off', isFocused: true, bodyColumns: 160, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}

const text = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const value = node as { children?: unknown[]; props?: { children?: unknown; label?: unknown } }
  const own = typeof value.props?.label === 'string' ? value.props.label : ''
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  return `${own}${children.map(text).join('')}\n`
}

const running = (id: number, nowMs: number) => {
  const at = new Date(nowMs).toISOString()
  return {
    id, label: `sim-${id}`, path: '/work', created_at: at,
    command: `pi --model opencode-go/flash:high --session-id pueue-sim-${id} -p 'x' < /dev/null`,
    status: { Running: { enqueued_at: at, start: at } },
  }
}

// A fake pueue beneath the plugin. Setting `armed` freezes the next `pueue status` call with the
// snapshot it would have returned at that moment, until `release` lets it answer; `reached` resolves once it is held.
const fakePueue = (on: On, nowMs: () => number) => {
  const tasks: Record<string, ReturnType<typeof running>> = {}
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
  return Object.assign(gate, { tasks })
}

const dispatch = '"pi --model opencode-go/flash:high --session-id pueue-sim -p x < /dev/null"'

test('a hand-off added while a poll is reading pueue stays tracked', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const gate = fakePueue(on, clock.now)

  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  gate.armed = true
  const ticking = clock.advance(2_000)
  await gate.reached

  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(text(await $.ui.render(PANE))).toContain('sim-2')
  gate.release!()
  await ticking

  const drawn = text(await $.ui.render(PANE))
  expect(drawn).toContain('#1')
  expect(drawn).toContain('#2')
})

test('a tracked hand-off removed from pueue outside the pane is dropped on the next poll', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const pueue = fakePueue(on, clock.now)

  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(text(await $.ui.render(PANE))).toContain('sim-1')
  delete pueue.tasks['1']
  await clock.advance(2_000)

  expect(text(await $.ui.render(PANE))).not.toContain('sim-1')
