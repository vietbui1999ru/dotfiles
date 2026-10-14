import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue, finished } from './fake-pueue'
import { finishNotice } from './handoff'

test('finish notices name the task, the result and how long it ran', () => {
  const base = { id: 44, cwd: '/w', addedMs: 0, label: 'sim3-running' }
  const task = (status: object) => ({ ...base, task: { id: 44, cwd: '/w', command: 'pi -p x', startMs: 0, endMs: 539_000, ...status } })
  expect(finishNotice(task({ state: 'Killed' }) as never, undefined)).toBe('pi#44 Killed after 8m59s · sim3-running')
  expect(finishNotice(task({ state: 'Done' }) as never, undefined)).toBe('pi#44 Done in 8m59s · sim3-running')
  expect(finishNotice(task({ state: 'Failed', exit: 1 }) as never, { error: '400: Model is unavailable.' } as never))
    .toBe('pi#44 Failed (exit 1) after 8m59s: 400: Model is unavailable. · sim3-running')
})

test('a hand-off seen running and then finished is notified once', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const sent: string[] = []
  on('ui.notify', (_$, e) => { sent.push((e as { text: string }).text); return { value: { isSent: true, channel: 'iterm2' } } as never })
  const pueue = fakePueue(on, clock.now)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  await clock.advance(2_000)
  expect(sent).toEqual([])
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Killed', clock.now())
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(sent.length).toBe(1)
  expect(sent[0]).toContain('pi#1 Killed')
})
