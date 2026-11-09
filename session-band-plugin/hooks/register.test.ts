import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ctxBar } from './format'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const BAND = {
  component: 'AbovePrompt' as const,
  surface: 'terminal' as const,
  requestId: 'session-band',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 1,
    bodyColumns: 160,
    scroll: { offset: 0, bodyRows: 1 },
    view: {},
  },
}

type UsageSource = { tokens: number; five?: number; seven?: number }

const usage = ({ tokens, five = 12, seven = 34 }: UsageSource) => ({
  startedAt: 0,
  context: { window: 1_000_000, tokens, percent: tokens / 10_000 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: five },
    { kind: 'seven_day', percentUsed: seven },
  ],
})

const textElements = (node: unknown): { color?: string; text: string }[] => {
  if (node === null || node === undefined) return []
  if (typeof node === 'string' || typeof node === 'number') return [{ text: String(node) }]

  const element = node as { type?: string; props?: { color?: string; children?: unknown }; children?: unknown[] }
  const propChildren = element.props?.children === undefined
    ? []
    : (Array.isArray(element.props.children) ? element.props.children : [element.props.children])
  const children = [...(element.children ?? []), ...propChildren].flatMap(textElements)

  return element.type === 'Text'
    ? [{ color: element.props?.color, text: children.map(child => child.text).join('') }, ...children]
    : children
}

const setup = (on: On, source: UsageSource) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  on('session.usage', () => ({ value: usage(source) }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
}

test('denies Agent at 350000 tokens and allows it at 349999', async ($, on) => {
  const source = { tokens: 350_000 }
  setup(on, source)

  const blocked = await $.tool.call({ tool: 'Agent', prompt: 'delegate this' } as never)
  expect(blocked.deny).toContain('CONTEXT THRESHOLD')

  source.tokens = 349_999
  const allowed = await $.tool.call({ tool: 'Agent', prompt: 'delegate this' } as never)
  expect('deny' in allowed).toBe(false)
})

test('adds the long then short soft-stop directives only after an auto-clear save failed', async ($, on) => {
  setup(on, { tokens: 350_000 })
  on('session.root', () => ({ value: '/work' }))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('agent.list', () => ({ value: [] }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.run', () => ({ text: 'Clear cancelled: nothing was saved.' }))
  on('turn.complete', () => ({ text: '' }))

  const before = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  expect(before.context).toBeUndefined()
  await $.turn.complete({ answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' })

  const first = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  const second = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })

  expect(first.context?.join('\n')).toContain('Last tool completed')
  expect(second.context?.join('\n')).toContain('still 70%+')
})

test('does not add a soft-stop directive to a save-critical write', async ($, on) => {
  setup(on, { tokens: 350_000 })

  const result = await $.tool.call({ tool: 'Write', file_path: '/work/.claude/session-state.md', content: 'saved' })

  expect(result.context).toBeUndefined()
})

test('draws whole ctx percentages of the 500K cap with green, yellow, and red threshold colours', async ($, on) => {
  const source = { tokens: 195_000 }
  setup(on, source)
  await $.session.start(START)

  for (const [percent, color] of [[39, '#a9b665'], [40, '#e78a4e'], [70, '#d75f5f']] as const) {
    source.tokens = percent * 5_000
    await $.session.measure({ context: { window: 1_000_000, tokens: percent * 5_000, percent: percent / 2 }, rateLimits: [], changed: ['context'] })

    const ctx = textElements(await $.ui.render(BAND))
      .find(element => element.color !== undefined && element.text === ctxBar(percent))
    expect(ctx?.color).toBe(color)
  }
})
