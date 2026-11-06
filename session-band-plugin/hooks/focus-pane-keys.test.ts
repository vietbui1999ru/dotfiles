// AC-10: the pane binds o, s, d and p as hotkeys, and drop never passes --yes. The engine mounts the
// pane, so this reads the rendered Buttons and the argv each press runs, not the source text.
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const, surface: 'terminal' as const, requestId: 'focus',
  props: { title: 'Focus', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { command: 'focus', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const STATUS = { work: null, hobby: { key: 'dotfiles:feat/focus', stage: 'build' }, frozen: [{ key: 'dotfiles:feat/old', stage: 'review' }], parked: [], read_only: false, breaches: [] }

const hotkeys = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { hotkey?: string; children?: unknown } }
  const kids = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : [value.props.children].flat())]
  return [...(value.type === 'Button' && value.props?.hotkey ? [value.props.hotkey] : []), ...kids.flatMap(hotkeys)]
}

test('the pane binds o s d p as hotkeys, once each, and drop never passes --yes', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/h', TMPDIR: '/tmp', USER: 'test', FOCUS_BOARD: '/h/Focus.md' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', () => ({ value: undefined } as never))
  on('session.cwd', () => ({ value: '/h/dotfiles' }))
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    return { value: { exitCode: 0, stdout: e.argv[1] === 'status' ? JSON.stringify(STATUS) : '', stderr: '' } } as never
  })
  await $.command.run(RUN)
  await clock.settle()
  const keys = hotkeys(await $.ui.render(PANE))
  for (const key of ['o', 's', 'd', 'p']) expect(keys.filter(k => k === key).length).toBe(1)

  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  for (const button of ['focus-key-open', 'focus-key-switch', 'focus-key-drop', 'focus-key-park']) {
    await ui.press({ key: button })
    await clock.settle()
  }
  const actions = calls.filter(argv => argv[1] !== 'status')
  expect(actions).toEqual([
    ['open', `obsidian://open?path=${encodeURIComponent('/h/Focus.md')}`],
    ['/h/dotfiles/scripts/focus', 'switch', 'dotfiles:feat/old'],
    ['/h/dotfiles/scripts/focus', 'drop', 'dotfiles:feat/old'],
    ['/h/dotfiles/scripts/focus', 'park', 'dotfiles:feat/old'],
  ])
  expect(calls.flat()).not.toContain('--yes')
})
