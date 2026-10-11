import { expect, mock, test } from 'claude-code/testing'

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
  on('process.run', (_$, e) => ({ value: { exitCode: 0, stdout: e.args[0] === 'pueue' ? '{"tasks":{}}' : '', stderr: '' } } as never))

  await $.command.run(command)
  expect(text(await $.ui.render(PANE))).toContain(HISTORY_LEGEND)
  expect(text(await $.ui.render(PANE))).toContain('No completed Pi hand-offs')
})

test('a closed history pane does not poll pueue, and reads session data in one MiB chunks', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-10T12:00:00Z') })
  on('ui.render', () => ({ type: 'Text', children: [''] } as never))
  let pueueCalls = 0
  on('process.run', (_$, e) => {
    if (e.args[0] === 'pueue') pueueCalls += 1
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as never
  })

  await $.ui.render(PANE)
  expect(pueueCalls).toBe(0)
  expect(tailChunkArgv('/tmp/session.jsonl', 4)).toEqual(['sh', '-c', 'tail -c "+$1" "$2" | head -c 1048576', 'pi-history-tail', '5', '/tmp/session.jsonl'])
})
