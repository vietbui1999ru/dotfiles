import { expect, test } from 'claude-code/testing'

import { finished, PANE, setupTracked as setup, text } from './fake-pueue'

test('Abort shows an inline confirm; Kill kills, Cancel does not', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  const drawn = text(await $.ui.render(PANE))
  expect(drawn).toContain('Kill #1')
  expect(pueue.calls).toEqual([])
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-cancel' })
  expect(text(await $.ui.render(PANE))).not.toContain('Kill #1?')
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toContainEqual(['kill', '1'])
})

test('a confirm whose task finished meanwhile kills nothing', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Success', clock.now())
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls.filter(call => call[0] === 'kill')).toEqual([])
})

test('a confirm older than a minute expires', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await clock.advance(61_000)
  expect(text(await $.ui.render(PANE))).not.toContain('Kill #1?')
  expect(pueue.calls.filter(call => call[0] === 'kill')).toEqual([])
})

test('Hold asks to confirm, then pauses the queue and kills the task', async ($, on) => {
  const { pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-hold' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toEqual([['pause', '--group', 'default', '--wait'], ['kill', '1']])
})

test('each live Monitor row has its own kill and pause buttons', async ($, on) => {
  const { pueue } = await setup($, on, 2) // #1 and #2 running
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-pause-2' })
  expect(pueue.calls).toContainEqual(['pause', '2'])
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-row-kill-1' })
  expect(text(await $.ui.render(PANE))).toContain('Kill #1')
})

test('finished rows have no kill or pause button', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  pueue.tasks['1'] = finished(pueue.tasks['1']!, { Failed: 1 }, clock.now())
  await clock.advance(2_000)
  const drawn = JSON.stringify(await $.ui.render(PANE))
  expect(drawn).not.toContain('pi-row-kill-1')
})
