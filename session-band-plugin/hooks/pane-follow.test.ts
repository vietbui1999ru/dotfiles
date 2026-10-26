import { expect, test } from 'claude-code/testing'

import { dispatch, finished, PANE, setupTracked as setup, text } from './fake-pueue'

const mountPane = ($: Parameters<typeof setup>[0]) => $.ui.mount({ plugin: 'session-band', ...PANE })
const marked = async (ui: Awaited<ReturnType<typeof mountPane>>) => /› \S #(\d+)/.exec(text(await ui.drawn()))?.[1]

// The transcript follows the newest running task until the person picks one; a pick that finishes lets go.
test('a picked task that finishes hands the transcript to the newest running task', async ($, on) => {
  const { clock, pueue } = await setup($, on, 2)
  const ui = await mountPane($)
  await ui.press({ key: 'pi-row-1' })
  await clock.settle()
  expect(await marked(ui)).toBe('1')
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Success', clock.now())
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(await marked(ui)).toBe('2')
})

test('picking an already finished task keeps it, so its transcript can be read', async ($, on) => {
  const { clock, pueue } = await setup($, on, 2)
  const ui = await mountPane($)
  pueue.tasks['1'] = finished(pueue.tasks['1']!, 'Success', clock.now())
  await clock.advance(2_000)
  await ui.press({ key: 'pi-row-1' })
  await clock.advance(2_000)
  await clock.advance(2_000)
  expect(await marked(ui)).toBe('1')
})

test('the ring landing on a row by a plugin, not the person, does not pin it', async ($, on) => {
  on('ui.focus', () => ({ value: {} } as never))
  const { clock } = await setup($, on, 1)
  // Added later than #1, so #2 is the newest running task the transcript follows unpinned.
  await clock.advance(1_000)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  const ui = await mountPane($)
  expect(await marked(ui)).toBe('2')
  await $.ui.focus({ component: 'Pane', requestId: 'pi-handoff', plugin: 'session-band', element: 'pi-row-1', origin: { kind: 'plugin', name: 'session-band' } } as never)
  expect(await marked(ui)).toBe('2')
})
