import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue, PANE, text } from './fake-pueue'

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
})

test('a finished hand-off offers Remove but not Abort or Pause', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const pueue = fakePueue(on, clock.now)

  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(text(await $.ui.render(PANE))).toContain('Abort')
  const at = new Date(clock.now()).toISOString()
  pueue.tasks['1'] = { ...pueue.tasks['1']!, status: { Done: { enqueued_at: at, start: at, end: at, result: { Failed: 1 } } } as never }
  await clock.advance(2_000)

  const drawn = text(await $.ui.render(PANE))
  expect(drawn).toContain('Remove')
  expect(drawn).not.toContain('Abort')
  expect(drawn).not.toContain('Pause')
})
