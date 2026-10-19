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

// A key with no hotkey in a focused pane falls through to the composer, so the vim keys must be hotkeys.
// The kit has no implementation of a plugin's own $.ui.focus, so the ring move is checked live, not here.
test('j, k and g move the selection a row and stop at the ends', async ($, on) => {
  const { clock } = await setup($, on, 3)
  const ui = await mountPane($)
  // onPress starts the move unawaited; settle before looking at what it did.
  const press = async (key: string) => { await ui.press({ key }); await clock.settle() }
  expect((await ui.find({ key: 'pi-key-down' }))?.props.hotkey).toBe('j')
  expect((await ui.find({ key: 'pi-key-up' }))?.props.hotkey).toBe('k')
  expect((await ui.find({ key: 'pi-key-top' }))?.props.hotkey).toBe('g')
  expect((await ui.find({ key: 'pi-key-reload' }))?.props.hotkey).toBe('r')
  for (let count = 0; count < 3; count += 1) await press('pi-key-down')
  expect(text(await ui.drawn())).toMatch(/› \S #3/)
  await press('pi-key-up')
  expect(text(await ui.drawn())).toMatch(/› \S #2/)
  await press('pi-key-top')
  expect(text(await ui.drawn())).toMatch(/› \S #1/)
  await press('pi-key-up')
  expect(text(await ui.drawn())).toMatch(/› \S #1/)
})

test('i is bound to the Continue field and q closes the pane', async ($, on) => {
  const closed: unknown[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } as never })
  const { clock } = await setup($, on)
  const ui = await mountPane($)
  expect((await ui.find({ key: 'pi-key-insert' }))?.props.hotkey).toBe('i')
  expect((await ui.find({ key: 'pi-key-quit' }))?.props.hotkey).toBe('q')
  await ui.press({ key: 'pi-key-quit' })
  await clock.settle()
  expect(closed).toContain('pi-handoff')
})
