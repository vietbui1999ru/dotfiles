import { expect, test } from 'claude-code/testing'

import { finished, PANE, queued, setupTracked as setup } from './fake-pueue'

test('kill reports uncommitted changes', async ($, on) => {
  const { pueue, toasts } = await setup($, on)
  pueue.porcelain = ' M hooks/pane.tsx\n?? notes.md\n'
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toContainEqual(['kill', '1'])
  expect(JSON.stringify(toasts)).toContain('/work holds 2 uncommitted changes; nothing was reverted.')
  // Read-only git: nothing that could discard or revert the worktree ran.
  for (const verb of ['checkout', 'reset', 'clean', 'restore', 'stash']) expect(pueue.git.flat()).not.toContain(verb)
})

test('Stop pauses the queue without killing the running task', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-stop' })
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait']])
})

test('pi pane offers stop kill remove edit', async ($, on) => {
  const { clock, pueue } = await setup($, on, 2)
  pueue.tasks['1'] = queued(1, clock.now())
  pueue.tasks['2'] = finished(pueue.tasks['2']!, 'Killed', clock.now())
  await clock.advance(2_000)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-1' })
  const queuedView = JSON.stringify(await $.ui.render(PANE))
  for (const key of ['pi-stop', 'pi-abort', 'pi-edit']) expect(queuedView).toContain(key)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-2' })
  const finishedView = JSON.stringify(await $.ui.render(PANE))
  expect(finishedView).toContain('pi-remove')
  expect(finishedView).not.toContain('pi-edit')
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-1' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-stop' })
  expect(pueue.calls).toContainEqual(['pause', '--group', 'default', '--wait'])
  await $.ui.input({ plugin: 'session-band', key: 'pi-edit', text: 'x/y:low relabel' })
  // editTask is not awaited by the input; settle so its process calls finish inside this test.
  for (let round = 0; round < 6; round += 1) await clock.settle()
  expect(pueue.calls).toContainEqual(['remove', '1'])
  const add = pueue.calls.find(call => call[0] === 'add')
  expect(add?.slice(0, 7)).toEqual(['add', '--print-task-id', '--label', 'relabel', '--group', 'default', '--'])
  expect(add?.[7]).toContain("--model 'x/y:low'")
})
