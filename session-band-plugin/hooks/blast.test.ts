import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }


const setup = (on: On, ask: 'Allow' | 'Deny' | 'reject' = 'Allow', onAsk?: (question: string) => unknown) => {
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 0 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never))
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = (e as { questions: { question: string }[] }).questions[0]?.question ?? ''
      await onAsk?.(question)
      if (ask === 'reject') throw new Error('dismissed')
      return { result: { answers: { [question]: ask } } } as never
    }
    return { result: 'ok', text: 'ok' }
  })
}

test('passes a read-only Bash command to the next hook', async ($, on) => {
  setup(on)

  const result = await $.tool.call({ tool: 'Bash', command: 'ls -la' })

  expect('deny' in result).toBe(false)
  expect(result.text).toBe('ok')
})

test('hard-denies a catastrophic Bash command without reaching next', async ($, on) => {
  setup(on)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm -rf /' })

  expect(result.deny).toContain('refused by blast-radius')
})

test('runs an ask-tier Bash command only after Allow', async ($, on) => {
  setup(on)
  await $.session.start(START)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm ./build' })

  expect('deny' in result).toBe(false)
  expect(result.text).toBe('ok')
})

test('shows preview facts without running the Bash command', async ($, on) => {
  let question = ''
  setup(on, 'Allow', value => { question = value })
  on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: 0, isLink: false } } as never))
  await $.session.start(START)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm /tmp/blast-test-file' })

  expect('deny' in result).toBe(false)
  expect(question).toContain('/tmp/blast-test-file (12 B), not git-tracked')
})

test('denies an ask-tier Bash command on Deny', async ($, on) => {
  setup(on, 'Deny')
  await $.session.start(START)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm ./build' })

  expect(result.deny).toContain('refused by blast-radius')
})

test('denies an ask-tier Bash command when the prompt is dismissed', async ($, on) => {
  setup(on, 'reject')
  await $.session.start(START)

  const result = await $.tool.call({ tool: 'Bash', command: 'rm ./build' })

  expect(result.deny).toContain('dismissed')
})

const PANE = {
  component: 'Pane' as const, surface: 'terminal' as const, requestId: 'blast',
  props: { title: 'Blast radius', isFocused: false, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const texts = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown; source?: string } }
  const kids = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : [value.props.children].flat())]
  if (value.type === 'Code') return [value.props?.source ?? '']
  if (value.type === 'Text') return [kids.filter(child => typeof child === 'string').join('')]
  return kids.flatMap(texts)
}

for (const answer of ['Allow', 'Deny', 'reject'] as const) {
  test(`the blast pane shows the facts while asking and closes after ${answer}`, async ($, on) => {
    const events: string[] = []
    let drawn: string[] = []
    // Drawn with the test's own $ while the question is still open.
    setup(on, answer, async () => {
      events.push('ask')
      drawn = texts(await $.ui.render(PANE))
    })
    on('fs.stat', () => ({ value: { kind: 'file', size: 12, mtimeMs: 0, isLink: false } } as never))
    on('ui.open', (_$, e) => { events.push(`open ${(e as { id: string }).id}`); return { value: { isPlaced: true } } as never })
    on('ui.close', (_$, e) => { events.push(`close ${(e as { id: string }).id}`); return { value: undefined } as never })
    await $.session.start(START)
    const result = await $.tool.call({ tool: 'Bash', command: 'rm /tmp/blast-test-file' })
    expect(events).toEqual(['open blast', 'ask', 'close blast'])
    expect(drawn).toContain('rm /tmp/blast-test-file')
    expect(drawn).toContain('  /tmp/blast-test-file (12 B)  untracked')
    expect('deny' in result).toBe(answer !== 'Allow')
  })
}

test('a pane that cannot open does not change the blast-radius answer', async ($, on) => {
  setup(on, 'Allow')
  on('ui.open', () => { throw new Error('no room') })
  await $.session.start(START)
  const result = await $.tool.call({ tool: 'Bash', command: 'rm ./build' })
  expect('deny' in result).toBe(false)
})

test('denies ask-tier Bash commands when the session is non-interactive', async ($, on) => {
  setup(on)
  await $.session.start({ ...START, isInteractive: false })

  const result = await $.tool.call({ tool: 'Bash', command: 'rm ./build' })

  expect(result.deny).toContain('nobody is available')
})
