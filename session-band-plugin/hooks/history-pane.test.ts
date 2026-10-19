import { expect, mock, test } from 'claude-code/testing'

import { text as labelText } from './fake-pueue'
import { HISTORY_LEGEND, tailChunkArgv } from './history.tsx'

const command = { command: 'pi-history', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'pi-history',
  props: { title: 'Pi history', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}

const text = (node: unknown): string => {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (!node || typeof node !== 'object') return ''
  const value = node as { children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  return children.map(text).join('')
}

test('the history pane renders its legend and can open with no tracked tasks', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.render', () => ({ type: 'Text', children: [''] } as never))
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'pueue' ? '{"tasks":{}}' : '', stderr: '' } } as never))

  await $.command.run(command)
  expect(text(await $.ui.render(PANE))).toContain(HISTORY_LEGEND)
  expect(text(await $.ui.render(PANE))).toContain('No completed Pi hand-offs')
})

test('a closed history pane does not poll pueue, and reads session data in one MiB chunks', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.render', () => ({ type: 'Text', children: [''] } as never))
  let pueueCalls = 0
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'pueue') pueueCalls += 1
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })

  await $.ui.render(PANE)
  expect(pueueCalls).toBe(0)
  expect(tailChunkArgv('/tmp/session.jsonl', 4)).toEqual(['sh', '-c', 'tail -c "+$1" "$2" | head -c 1048576', 'pi-history-tail', '5', '/tmp/session.jsonl'])
})

test('j, k and g move the history selection; q closes the pane', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  const closed: unknown[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } as never })
  // No --session-id, so rendering starts no lazy usage load that would outlive the test.
  const done = (id: number, label: string, end: string) => ({
    id, label, path: '/repo', command: 'pi --model openai/gpt:high -p x < /dev/null', created_at: '2026-10-10T11:00:00Z',
    status: { Done: { enqueued_at: '2026-10-10T11:00:00Z', start: '2026-10-10T11:00:01Z', end, result: 'Success' } },
  })
  const status = JSON.stringify({ tasks: { '5': done(5, 'run-five', '2026-10-10T11:10:00Z'), '6': done(6, 'run-six', '2026-10-10T11:20:00Z') } })
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.argv[0] === 'pueue' && e.argv[1] !== 'log' ? status : '{}', stderr: '' } } as never))
  await $.command.run(command)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  const press = async (key: string) => { await ui.press({ key }); await clock.settle() }
  const selected = async () => /› ([^\n]*)/.exec(labelText(await ui.drawn()))?.[1]
  expect((await ui.find({ key: 'pi-history-key-down' }))?.props.hotkey).toBe('j')
  expect((await ui.find({ key: 'pi-history-key-up' }))?.props.hotkey).toBe('k')
  expect((await ui.find({ key: 'pi-history-key-top' }))?.props.hotkey).toBe('g')
  expect((await ui.find({ key: 'pi-history-key-reload' }))?.props.hotkey).toBe('r')
  const first = await selected()
  await press('pi-history-key-down')
  const second = await selected()
  expect(second).not.toBe(first)
  await press('pi-history-key-down')
  expect(await selected()).toBe(second)
  await press('pi-history-key-top')
  expect(await selected()).toBe(first)
  await press('pi-history-key-quit')
  expect(closed).toContain('pi-history')
})

test('a Failed(1) run whose log shows it left a review is not drawn as a failure', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.render', () => ({ type: 'Text', children: [''] } as never))
  const status = JSON.stringify({ tasks: { '5': {
    // No --session-id, so rendering starts no lazy usage load that would outlive the test.
    id: 5, label: 'reviewed-run', path: '/repo', command: 'pi --model openai/gpt:high -p "$(cat /tmp/p)" < /dev/null', created_at: '2026-10-10T11:00:00Z',
    status: { Done: { enqueued_at: '2026-10-10T11:00:00Z', start: '2026-10-10T11:00:01Z', end: '2026-10-10T11:10:00Z', result: { Failed: 1 } } },
  } } })
  const log = JSON.stringify({ '5': { task: {}, output: 'agent-review: run reviewed-run (11111111-2222-4333-8444-555555555555) changed 2 file(s) and is awaiting review.' } })
  let logReads = 0
  on('process.run', (_$, e) => {
    if (e.argv[0] === 'pueue' && e.argv[1] === 'log') { logReads += 1; return { value: { exitCode: 0, stdout: log, stderr: '' } } as never }
    if (e.argv[0] === 'pueue') return { value: { exitCode: 0, stdout: status, stderr: '' } } as never
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })

  await $.command.run(command)
  // The detail section still states the raw `Result: exit 1`; the row itself must not read as a failure.
  const body = text(await $.ui.render(PANE)).split(HISTORY_LEGEND)[1] ?? ''
  expect(body).toContain('reviewed-run')
  expect(body).toContain('✓')
  expect(body).not.toContain('✗')
  expect(logReads).toBe(1)
})
