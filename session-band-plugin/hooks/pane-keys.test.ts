import { expect, test } from 'claude-code/testing'

import { PANE, setupTracked as setup, text } from './fake-pueue'

const mountPane = ($: Parameters<typeof setup>[0]) => $.ui.mount({ plugin: 'session-band', ...PANE })

// Hotkeys reach a focused pane without a click; a Client's onKey only reaches a clicked Client.
test('the controls carry their hotkeys and no key Client is drawn', async ($, on) => {
  await setup($, on)
  const ui = await mountPane($)
  expect((await ui.find({ key: 'pi-abort' }))?.props.hotkey).toBe('x')
  expect((await ui.find({ key: 'pi-hold' }))?.props.hotkey).toBe('h')
  expect((await ui.find({ key: 'pi-pause' }))?.props.hotkey).toBe('p')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.press({ key: 'pi-abort' })
  expect((await ui.find({ key: 'pi-confirm-ok' }))?.props.hotkey).toBe('y')
  expect((await ui.find({ key: 'pi-confirm-cancel' }))?.props.hotkey).toBe('n')
})

test('the focus ring landing on a monitor row selects that task', async ($, on) => {
  on('ui.focus', () => ({ value: {} } as never))
  const { pueue } = await setup($, on, 2)
  const ui = await mountPane($)
  // The event as the engine raises it for the person's ↓, not the kit's $.ui.focus args shape.
  await $.ui.focus({ component: 'Pane', requestId: 'pi-handoff', plugin: 'session-band', element: 'pi-row-2', origin: { kind: 'person' } } as never)
  await ui.press({ key: 'pi-abort' })
  expect(text(await ui.drawn())).toMatch(/Kill #2/)
  await ui.press({ key: 'pi-confirm-ok' })
  expect(pueue.calls).toContainEqual(['kill', '2'])
})
