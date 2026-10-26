import { expect, test } from 'claude-code/testing'

import { dispatch, finished, PANE, setupTracked as setup, text } from './fake-pueue'
import { stackedSections } from './pane'
import { emptyProgress } from './pisession'

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

// Several running tasks at once: each gets an equal share of the rows, newest lines kept.
test('the all view splits the row budget evenly and keeps each task\'s newest lines', () => {
  const entries = Array.from({ length: 30 }, (_, index) => ({ kind: 'text' as const, text: `line ${index}` }))
  const progress = { 1: { ...emptyProgress(), entries }, 2: { ...emptyProgress(), entries: entries.slice(0, 2) } }
  const sections = stackedSections([1, 2], progress, false, 20)
  expect(sections.map(section => section.id)).toEqual([1, 2])
  expect(sections[0]!.lines.map(line => line.text)).toEqual(['line 21', 'line 22', 'line 23', 'line 24', 'line 25', 'line 26', 'line 27', 'line 28', 'line 29'])
  expect(sections[1]!.lines.map(line => line.text)).toEqual(['line 0', 'line 1'])
  // A crowded pane still shows a few lines per task rather than none.
  expect(stackedSections([1, 2, 3, 4, 5, 6], progress, false, 10)[0]!.lines.length).toBe(3)
})

test('v toggles the all view: one header per running task, then back to one transcript', async ($, on) => {
  const { clock } = await setup($, on, 2)
  const ui = await mountPane($)
  expect((await ui.find({ key: 'pi-key-all' }))?.props.hotkey).toBe('v')
  await ui.press({ key: 'pi-key-all' })
  await clock.settle()
  const all = text(await ui.drawn())
  expect(all).toMatch(/── pi#1 Running/)
  expect(all).toMatch(/── pi#2 Running/)
  await ui.press({ key: 'pi-key-all' })
  await clock.settle()
  expect(text(await ui.drawn())).not.toMatch(/── pi#/)
})
