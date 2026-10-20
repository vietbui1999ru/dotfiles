import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue } from './fake-pueue'

test('dispatch starts a stopped daemon', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const pueue = fakePueue(on, clock.now)
  pueue.down = true
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(pueue.order).toEqual(['pueued -d', 'pueue start --group default', 'add'])
  expect(pueue.down).toBe(false)
})

test('a paused or zero-worker group is started before a dispatch', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const pueue = fakePueue(on, clock.now)
  pueue.group = 'Paused'
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  pueue.parallel = 0
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(pueue.order).toEqual(['pueue start --group default', 'add', 'pueue start --group default', 'add'])
})

test('a dispatch to a running queue starts nothing', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test' })
  const pueue = fakePueue(on, clock.now)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(pueue.order).toEqual(['add'])
})
