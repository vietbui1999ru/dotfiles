import { expect, mock, test } from 'claude-code/testing'

import { finished, PANE, setupTracked as setup } from './fake-pueue'

const hotkeys = (node: unknown): string[] => {
  if (Array.isArray(node)) return node.flatMap(hotkeys)
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; props?: { hotkey?: string; children?: unknown }; children?: unknown[] }
  return [
    ...(value.type === 'Button' && value.props?.hotkey ? [value.props.hotkey] : []),
    ...hotkeys(value.children),
    ...hotkeys(value.props?.children),
  ]
}

const piKeys = 'j k g i r b f q x h p s y n t 1 2 3 4 5'.split(' ')
const expectPiKeys = (node: unknown) => {
  const keys = hotkeys(node)
  for (const key of piKeys) expect(keys.filter(value => value === key)).toEqual([key])
  expect(new Set(keys).size).toBe(keys.length)
}

test('empty /pi binds every hotkey exactly once and inactive keys have no effects', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const processes: string[][] = []
  const toasts: string[] = []
  const focused: unknown[] = []
  on('process.run', (_$, e) => { processes.push([...e.argv]); return { value: { exitCode: 0, stdout: '', stderr: '' } } as never })
  on('ui.toast', (_$, e) => { toasts.push(e.text); return { value: undefined } as never })
  on('ui.focus', (_$, e) => { focused.push(e); return { value: {} } as never })
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  expectPiKeys(await ui.drawn())
  for (const key of ['pi-abort', 'pi-hold', 'pi-pause', 'pi-stop']) expect(await ui.find({ key })).toBeUndefined()
  for (const [key, label] of [['abort', 'kill'], ['hold', 'hold'], ['pause', 'pause'], ['stop', 'stop'], ['yes', 'confirm'], ['no', 'cancel']]) {
    const button = await ui.find({ key: `pi-key-${key}` })
    expect(button?.props.plain).toBe(true)
    expect(button?.props.dimColor).toBe(true)
    expect(button?.props.label).toBe(label)
  }
  for (const key of ['pi-key-down', 'pi-key-up', 'pi-key-top', 'pi-key-insert', 'pi-key-abort', 'pi-key-hold', 'pi-key-pause', 'pi-key-stop', 'pi-key-yes', 'pi-key-no']) {
    await ui.press({ key })
    await clock.settle()
  }
  expect(processes).toEqual([])
  expect(toasts).toEqual([])
  expect(focused).toEqual([])
  expect(await ui.find({ key: 'pi-confirm-ok' })).toBeUndefined()
  expect(await ui.find({ key: 'pi-confirm-cancel' })).toBeUndefined()
})

test('a pending confirm exclusively holds y/n and y kills as before', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  expectPiKeys(await ui.drawn())
  await ui.press({ key: 'pi-abort' })
  await clock.settle()
  expectPiKeys(await ui.drawn())
  expect(await ui.find({ key: 'pi-key-yes' })).toBeUndefined()
  expect(await ui.find({ key: 'pi-key-no' })).toBeUndefined()
  expect((await ui.find({ key: 'pi-confirm-ok' }))?.props.hotkey).toBe('y')
  expect((await ui.find({ key: 'pi-confirm-cancel' }))?.props.hotkey).toBe('n')
  await ui.press({ key: 'pi-confirm-ok' })
  await clock.settle()
  expect(pueue.calls).toContainEqual(['kill', '1'])
  expectPiKeys(await ui.drawn())
  expect((await ui.find({ key: 'pi-key-yes' }))?.props.hotkey).toBe('y')
})

test('cancel returns y/n to the inert key bar without killing', async ($, on) => {
  const { clock, pueue } = await setup($, on)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'pi-abort' })
  await clock.settle()
  await ui.press({ key: 'pi-confirm-cancel' })
  await clock.settle()
  expectPiKeys(await ui.drawn())
  expect(await ui.find({ key: 'pi-confirm-ok' })).toBeUndefined()
  await ui.press({ key: 'pi-key-yes' })
  await ui.press({ key: 'pi-key-no' })
  await clock.settle()
  expect(pueue.calls).toEqual([])
})

for (const result of ['Success', 'Killed', { Failed: 1 }] as const) {
  test(`finished /pi task ${JSON.stringify(result)} retains dimmed no-op action hotkeys`, async ($, on) => {
    const { clock, pueue, toasts } = await setup($, on)
    pueue.tasks['1'] = finished(pueue.tasks['1']!, result, clock.now())
    await clock.advance(2_000)
    const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
    expectPiKeys(await ui.drawn())
    const callsBefore = pueue.calls.length
    const toastsBefore = toasts.length
    for (const key of ['abort', 'hold', 'pause', 'stop']) {
      expect(await ui.find({ key: `pi-${key}` })).toBeUndefined()
      expect((await ui.find({ key: `pi-key-${key}` }))?.props.dimColor).toBe(true)
      await ui.press({ key: `pi-key-${key}` })
      await clock.settle()
    }
    expect(pueue.calls.slice(callsBefore)).toEqual([])
    expect(toasts.slice(toastsBefore)).toEqual([])
    expect(await ui.find({ key: 'pi-confirm-ok' })).toBeUndefined()
  })
}

test('empty history binds j/k/g and moving does not focus a missing row', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const focused: unknown[] = []
  on('ui.focus', (_$, e) => { focused.push(e); return { value: {} } as never })
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE, requestId: 'pi-history', props: { ...PANE.props, title: 'Pi history' } })
  const keys = hotkeys(await ui.drawn())
  for (const key of ['j', 'k', 'g']) expect(keys.filter(value => value === key)).toEqual([key])
  for (const key of ['down', 'up', 'top']) {
    await ui.press({ key: `pi-history-key-${key}` })
    await clock.settle()
  }
  expect(focused).toEqual([])
})
