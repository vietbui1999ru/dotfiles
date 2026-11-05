// AC-10: the pane binds o, s, d and p as hotkeys, and drop never passes --yes. The engine renders the
// Buttons, so this reads the source rather than mounting it. A separate file keeps the pure tests off
// the engine import graph.
import { expect, test } from 'bun:test'

test('the pane binds o s d p as hotkeys, once each, and drop never passes --yes', async () => {
  const source = await Bun.file(new URL('./focus-pane.tsx', import.meta.url)).text()
  for (const key of ['o', 's', 'd', 'p']) expect(source.match(new RegExp(`hotkey="${key}"`, 'g'))?.length).toBe(1)
  expect(source).not.toContain('--yes')
})
