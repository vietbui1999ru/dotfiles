import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

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

type UsageSource = { percent: number; five?: number; seven?: number }

const usage = ({ percent, five = 12, seven = 34 }: UsageSource) => ({
  startedAt: 0,
  context: { window: 200_000, percent },
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

test('denies Agent at 70% and allows it at 69%', async ($, on) => {
  const source = { percent: 70 }
  setup(on, source)

  const blocked = await $.tool.call({ tool: 'Agent', prompt: 'delegate this' } as never)
  expect(blocked.deny).toContain('CONTEXT THRESHOLD')

  source.percent = 69
  const allowed = await $.tool.call({ tool: 'Agent', prompt: 'delegate this' } as never)
  expect('deny' in allowed).toBe(false)
})

test('adds the long then short soft-stop directives while over the threshold', async ($, on) => {
  setup(on, { percent: 70 })

  const first = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })
  const second = await $.tool.call({ tool: 'Read', file_path: '/work/README.md' })

  expect(first.context?.join('\n')).toContain('Last tool completed')
  expect(second.context?.join('\n')).toContain('still 70%+')
})

test('does not add a soft-stop directive to a save-critical write', async ($, on) => {
  setup(on, { percent: 70 })

  const result = await $.tool.call({ tool: 'Write', file_path: '/work/.claude/session-state.md', content: 'saved' })

  expect(result.context).toBeUndefined()
})

test('draws whole ctx percentages with green, yellow, and red threshold colours', async ($, on) => {
  const source = { percent: 39 }
  setup(on, source)
  await $.session.start(START)

  for (const [percent, color] of [[39, '#a9b665'], [40, '#d8a657'], [70, '#d75f5f']] as const) {
    source.percent = percent
    await $.session.measure({ context: { window: 200_000, percent }, rateLimits: [], changed: ['context'] })

    const ctx = textElements(await $.ui.render(BAND))
      .find(element => element.color !== undefined && element.text === ` ctx:${percent}%`)
    expect(ctx?.color).toBe(color)
  }
})
