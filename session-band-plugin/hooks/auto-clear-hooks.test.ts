import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const TURN = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }
const CANCELLED = 'Clear cancelled: nothing was saved.'
const AUTO = { trigger: 'auto', messages: [{ role: 'user', text: 'hello', toolUses: [] }] } as never

const setup = (on: On, over: { tokens?: number; clearText?: string } = {}) => {
  const world = { tokens: 350_000, clearText: 'Session saved: /work/.agents/sessions/x.md', calls: [] as string[], prompts: [] as string[], toasts: [] as string[], ...over }

  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000, tokens: world.tokens, percent: 35 }, rateLimits: [] } }))
  on('session.root', () => ({ value: '/work' }))
  on('session.cwd', () => ({ value: '' }))
  on('session.id', () => ({ value: 's1' }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } } as never))
  on('fs.read', () => { throw new Error('ENOENT') })
  on('agent.list', () => ({ value: [] }))
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('prompt.submit', ($, e) => { world.prompts.push(e.text); return { text: 'ok' } as never })
  on('ui.toast', ($, e) => { world.toasts.push(e.text); return { value: undefined } })
  on('command.run', ($, e) => { world.calls.push(e.command); return { text: world.clearText } })
  on('turn.complete', () => { world.calls.push('engine-end'); return { text: '' } })
  on('session.compact', ($, e) => ({ messages: e.messages }))
  return world
}

test('over the threshold the clear runs after the turn ends and the intro names the saved file', async ($, on) => {
  const world = setup(on)
  await $.turn.complete(TURN)
  expect(world.calls).toEqual(['engine-end', 'clear'])
  expect(world.prompts[0]).toContain('/work/.agents/sessions/x.md')
})

test('under the threshold or after an aborted turn nothing is cleared', async ($, on) => {
  const world = setup(on, { tokens: 349_999 })
  await $.turn.complete(TURN)
  world.tokens = 350_000
  await $.turn.complete({ ...TURN, reason: 'aborted', isAborted: true })
  expect(world.calls).not.toContain('clear')
  expect(world.prompts).toEqual([])
})

test('auto compaction is skipped until a save fails, then it runs and no intro is sent', async ($, on) => {
  const world = setup(on, { clearText: CANCELLED })
  expect('skip' in await $.session.compact(AUTO)).toBe(true)
  await $.turn.complete(TURN)
  expect(world.prompts).toEqual([])
  expect(world.toasts[0]).toContain('Compaction is back on')
  expect('skip' in await $.session.compact(AUTO)).toBe(false)
})
