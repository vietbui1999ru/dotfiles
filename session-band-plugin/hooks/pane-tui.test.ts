import { expect, mock, test, type TestBody } from 'claude-code/testing'

import { fakePueue, PANE } from './fake-pueue'
import { isTuiDispatch } from './pueue'

// The dispatch shape `--tui` runs have, and the pane id pi-view writes for it. The
// fake's own dispatch keeps its session id, which is what the tracker recorded.
const TUI_COMMAND = `scripts/pi-view --tui pi --model opencode-go/flash:high --session-id pueue-sim-1 -p 'x' < /dev/null`
const PANE_ID = 'w2:p9'
const PANE_FILE = '/tmp/pi-view/pueue-sim-1.pane'

type Kit = Parameters<TestBody>
type Setup = { command?: string; paneFile?: boolean; tab?: string; label?: string }

/**
 * Fake pueue with one running dispatch, herdr answering `pane get` and `tab list`
 * (both from `pueue.herdrPane`), and the pane file pi-view writes. The fake's own
 * dispatch becomes the `--tui` one once the poller sees the new command.
 */
const setup = async ($: Kit[0], on: Kit[1], options: Setup = {}) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp', HERDR_TAB_ID: 'w1:t1' })
  const pueue = fakePueue(on, clock.now)
  pueue.herdrPane = { pane: PANE_ID, tab: options.tab ?? 'w1:t1', label: options.label ?? '1' }
  on('fs.read', (_$, e) => {
    if (options.paneFile !== false && e.path === PANE_FILE) return { value: `${PANE_ID}\n` } as never
    throw new Error('ENOENT')
  })
  on('fs.write', () => ({ value: undefined } as never))
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  const toasts: unknown[] = []
  on('ui.toast', (_$, e) => { toasts.push(e); return { value: undefined } as never })
  await $.tool.call({ tool: 'Bash', command: 'pueue add -- pi --model m -p x' })
  pueue.tasks['1'] = { ...pueue.tasks['1']!, command: options.command ?? TUI_COMMAND }
  await clock.advance(2_000)
  return { clock, pueue, herdr: pueue.herdr, toasts }
}

const mount = ($: Kit[0]) => $.ui.mount({ plugin: 'session-band', ...PANE })

test("Continue types into the --tui run's pane instead of starting a dispatch", async ($, on) => {
  const { clock, pueue } = await setup($, on)
  await $.ui.render(PANE)
  await $.ui.input({ plugin: 'session-band', key: 'pi-continue', text: 'rebuild the parser' })
  await clock.settle()
  expect(pueue.herdr).toContainEqual(['pane', 'send-text', PANE_ID, 'rebuild the parser'])
  expect(pueue.herdr).toContainEqual(['pane', 'send-keys', PANE_ID, 'Enter'])
  expect(pueue.calls.filter(call => call[0] === 'add')).toEqual([])
})

test('Continue of an ordinary run still adds a pueue dispatch', async ($, on) => {
  const { clock, pueue } = await setup($, on, { command: 'pi --model opencode-go/flash:high --session-id pueue-sim-1 -p x < /dev/null' })
  await $.ui.render(PANE)
  await $.ui.input({ plugin: 'session-band', key: 'pi-continue', text: 'again' })
  await clock.settle()
  expect(pueue.calls.filter(call => call[0] === 'add')).toHaveLength(1)
  expect(pueue.herdr.filter(argv => argv[1] === 'send-text')).toEqual([])
})

test('Close quits Pi with ctrl+d, which ends the task', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  const ui = await mount($)
  expect((await ui.find({ key: 'pi-tui-close' }))?.props.label).toBe('\uF08B')
  await ui.press({ key: 'pi-tui-close' })
  await clock.settle()
  expect(pueue.herdr).toContainEqual(['pane', 'send-keys', PANE_ID, 'ctrl+d'])
  expect(pueue.calls.filter(call => call[0] === 'kill')).toEqual([])
})

test('Focus jumps to the pane, and the monitor row says where it is', async ($, on) => {
  const { clock, pueue } = await setup($, on, { tab: 'w1:t9', label: 'verdict' })
  const ui = await mount($)
  expect(await ui.find({ key: 'pi-tui-focus' })).toBeDefined()
  await ui.press({ key: 'pi-tui-focus' })
  await clock.settle()
  expect(pueue.herdr).toContainEqual(['agent', 'focus', PANE_ID])
  expect(await ui.find({ key: 'pi-tui-focus' })).toBeDefined()
  expect(JSON.stringify(await ui.drawn())).toContain('verdict')
})

test('a running --tui run without a pane file gets no pane controls', async ($, on) => {
  const { pueue } = await setup($, on, { paneFile: false })
  const ui = await mount($)
  expect(await ui.find({ key: 'pi-tui-focus' })).toBeUndefined()
  expect(await ui.find({ key: 'pi-tui-close' })).toBeUndefined()
  // Nothing is asked of herdr for a pane the mod cannot name.
  expect(pueue.herdr.filter(argv => argv[0] === 'agent' || argv[1] === 'send-text')).toEqual([])
})

test('isTuiDispatch reads the wrapper flag, not a --tui word in the prompt', () => {
  expect(isTuiDispatch(TUI_COMMAND)).toBe(true)
  expect(isTuiDispatch("scripts/pi-view pi --model m --session-id pueue-x -p '--tui here'")).toBe(false)
  expect(isTuiDispatch('pi --model m --session-id pueue-x -p x')).toBe(false)
})
