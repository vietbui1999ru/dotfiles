import { expect, test } from 'claude-code/testing'

import { setupTracked } from './fake-pueue'

const run = (args: string) => ({ command: 'pi', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } })
const setup = ($: Parameters<typeof setupTracked>[0], on: Parameters<typeof setupTracked>[1]) => setupTracked($, on, 2)

test('/pi kill <ids> kills those Pi hand-offs and says so', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill 1 2'))
  expect(pueue.calls).toContainEqual(['kill', '1', '2'])
  expect(reply.text).toContain('#1')
})

test('/pi kill with nothing eligible makes no pueue call', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill 99'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('99')
})

test('/pi kill refuses an id that is not a Pi hand-off', async ($, on) => {
  const { pueue } = await setup($, on)
  pueue.tasks['7'] = { ...pueue.tasks['1']!, id: 7, command: 'make build' }
  const reply = await $.command.run(run('kill 7'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('not a Pi hand-off')
})

test('/pi hold pauses the group without its running tasks, kills the target, and says how to release', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('hold 1'))
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait'], ['kill', '1']])
  expect(reply.text).toContain('/pi release')
  await $.command.run(run('release'))
  expect(pueue.calls.at(-1)).toEqual(['start', '--group', 'default'])
})

test('/pi kill all asks for confirmation in the pane instead of killing', async ($, on) => {
  const { pueue } = await setup($, on)
  const reply = await $.command.run(run('kill all'))
  expect(pueue.calls).toEqual([])
  expect(reply.text).toContain('confirm')
})

test('/pi with no arguments still opens the pane', async ($, on) => {
  await setup($, on)
  expect((await $.command.run(run(''))).text).toBe('Pi hand-off pane opened.')
})

const queue = (task: { status: unknown }) => {
  task.status = { Queued: { enqueued_at: new Date(1_000_000).toISOString() } }
}

test('/pi kill removes a queued hand-off, which pueue kill cannot stop', async ($, on) => {
  const { pueue } = await setup($, on)
  queue(pueue.tasks['2']!)
  const reply = await $.command.run(run('kill 1 2'))
  expect(pueue.calls).toEqual([['kill', '1'], ['remove', '2']])
  expect(reply.text).toContain('#2')
  expect(pueue.tasks['2']).toBeUndefined()
})

test('/pi kill reports a pueue failure instead of claiming success', async ($, on) => {
  const { pueue } = await setup($, on)
  pueue.failing.add('kill')
  const reply = await $.command.run(run('kill 1'))
  expect(reply.text).toContain('failed')
  expect(reply.text).not.toContain('Killed')
})

test('/pi hold does not kill when the queue could not be paused', async ($, on) => {
  const { pueue } = await setup($, on)
  pueue.failing.add('pause')
  const reply = await $.command.run(run('hold 1'))
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait']])
  expect(reply.text).toContain('failed')
})
