import { expect, test } from 'claude-code/testing'

import { PANE, setupTracked as setup } from './fake-pueue'

// The key strip's words are icons now; the hotkey hint beside each one is the legend.
const GLYPHS: [string, string, string][] = [
  ['pi-key-down', 'j', '\uF063'],
  ['pi-key-up', 'k', '\uF062'],
  ['pi-key-top', 'g', '\uF102'],
  ['pi-key-insert', 'i', '\uF040'],
  ['pi-key-reload', 'r', '\uF021'],
  ['pi-key-prev', 'b', '\uF053'],
  ['pi-key-next', 'f', '\uF054'],
  ['pi-key-quit', 'q', '\uF00D'],
  ['pi-key-thinking', 't', '\uF075'],
  ['pi-key-all', 'v', '\uF00B'],
  ['pi-key-abort', 'x', '\uF057'],
  ['pi-key-hold', 'h', '\uF28B'],
  ['pi-key-pause', 'p', '\uF04C'],
  ['pi-key-stop', 's', '\uF04D'],
  ['pi-key-yes', 'y', '\uF00C'],
  ['pi-key-no', 'n', '\uF05E'],
]

test('every key-strip button keeps its hotkey and draws its icon', async ($, on) => {
  const { clock } = await setup($, on, 0)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  for (const [key, hotkey, glyph] of GLYPHS) {
    const button = await ui.find({ key })
    expect(button?.props.hotkey).toBe(hotkey)
    expect(button?.props.label).toBe(glyph)
  }
  // The two toggles swap to their outline icon.
  await ui.press({ key: 'pi-key-thinking' })
  await ui.press({ key: 'pi-key-all' })
  await clock.settle()
  expect((await ui.find({ key: 'pi-key-thinking' }))?.props.label).toBe('\uF0E5')
  expect((await ui.find({ key: 'pi-key-all' }))?.props.label).toBe('\uF096')
})

test('the ctrl+x b hint and the pane jumps keep their words', async ($, on) => {
  await setup($, on, 0)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  expect((await ui.find({ key: 'pi-key-focus' }))?.props.label).toBe('ctrl+x b')
  expect((await ui.find({ key: 'pi-key-jump-1' }))?.props.hotkey).toBe('1')
  expect((await ui.find({ key: 'pi-key-jump-1' }))?.props.label).toBe('pi')
})
