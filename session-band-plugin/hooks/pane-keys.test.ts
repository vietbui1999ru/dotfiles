import { expect, test } from 'claude-code/testing'

import { PANE, setupTracked as setup, text } from './fake-pueue'

const mountPane = ($: Parameters<typeof setup>[0]) => $.ui.mount({ plugin: 'session-band', ...PANE })

test('arrow keys move the selection and x asks to kill the selected task', async ($, on) => {
  const { pueue } = await setup($, on, 2)
  const ui = await mountPane($)
  await ui.post({ key: 'down' }, { in: 'pi-keys' })
  await ui.post({ key: 'x' }, { in: 'pi-keys' })
  expect(text(await ui.drawn())).toMatch(/Kill #\d/)
  await ui.post({ key: 'y' }, { in: 'pi-keys' })
  expect(pueue.calls.some(call => call[0] === 'kill')).toBe(true)
})

test('posted data that is not a known key is ignored', async ($, on) => {
  const { pueue } = await setup($, on)
  const ui = await mountPane($)
  await ui.post({ key: 'rm -rf' }, { in: 'pi-keys' })
  await ui.post(42, { in: 'pi-keys' })
  expect(pueue.calls).toEqual([])
})

test('a pressed x on the key strip posts a kill confirm', async ($, on) => {
  await setup($, on)
  const ui = await mountPane($)
  await ui.key({ key: 'x', in: 'pi-keys' })
  expect(text(await ui.drawn())).toMatch(/Kill #\d/)
})
