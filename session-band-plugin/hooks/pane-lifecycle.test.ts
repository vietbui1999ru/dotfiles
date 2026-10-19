import { expect, test } from 'claude-code/testing'

import { PANE, setupTracked as setup } from './fake-pueue'

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
