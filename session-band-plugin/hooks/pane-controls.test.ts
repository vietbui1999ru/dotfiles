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

// `pueue kill` SIGKILLs the task's group, so Pi never reaps the bash tools it ran in groups of their own.
test('Kill also kills the process groups the task tree left outside its group', async ($, on) => {
  const { pueue } = await setup($, on)
  pueue.ps = [
    `  200   100   200 sh -c ${pueue.tasks[1]!.command}`,
    '  201   200   200 node pi',
    '  300   201   300 /bin/zsh -c sleep 900',
  ].join('\n')
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(pueue.calls).toContainEqual(['kill', '1'])
  expect(pueue.signals).toEqual([['-KILL', '--', '-300']])
})

// `pueue pause` SIGSTOPs only the task's group, so the detached tool group keeps running unless it is stopped too.
test('Pause also stops, and Resume also continues, the tool groups outside the task group', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  pueue.ps = [
    `  200   100   200 sh -c ${pueue.tasks[1]!.command}`,
    '  201   200   200 node pi',
    '  300   201   300 /bin/zsh -c sleep 900',
  ].join('\n')
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-pause' })
  expect(pueue.calls).toContainEqual(['pause', '1'])
  expect(pueue.signals).toEqual([['-STOP', '--', '-300']])
  // The button reads the poll's state, so let one poll see the pause before Resume is pressed.
  await clock.advance(2_000)
  expect(text(await $.ui.render(PANE))).toContain('Resume')
  await $.ui.press({ plugin: 'session-band', key: 'pi-pause' })
  expect(pueue.calls).toContainEqual(['start', '1'])
  expect(pueue.signals).toEqual([['-STOP', '--', '-300'], ['-CONT', '--', '-300']])
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

// Each row is one focus stop, so an arrow moves one row; kill and pause act on the selected row.
test('Monitor rows carry no kill or pause buttons of their own', async ($, on) => {
  await setup($, on, 2) // #1 and #2 running
  const drawn = JSON.stringify(await $.ui.render(PANE))
  expect(drawn).toContain('pi-row-2')
  expect(drawn).not.toContain('pi-row-kill-')
  expect(drawn).not.toContain('pi-row-pause-')
})

test('a confirm refused for a task gone from pueue says why', async ($, on) => {
  const { pueue, toasts } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-abort' })
  delete pueue.tasks['1']
  await $.ui.render(PANE)
  await $.ui.press({ plugin: 'session-band', key: 'pi-confirm-ok' })
  expect(JSON.stringify(toasts)).toContain('Nothing to kill. Skipped #1 (not in pueue).')
})

test('y has nothing to press with no confirm showing', async ($, on) => {
  const { pueue, toasts } = await setup($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  expect(await ui.find({ key: 'pi-confirm-ok' })).toBeUndefined()
  expect(toasts).toEqual([])
  expect(pueue.calls).toEqual([])
})
