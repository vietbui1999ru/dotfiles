import { expect, mock, test } from 'claude-code/testing'

import { GH_ARGV, GH_AUTH } from './draft-prs'
import { HEADERS, NOW, PRS, ROWS } from './draft-prs-fixture'

const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'draft-prs',
  props: { title: 'Draft PRs', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { command: 'draft-prs', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }

const lines = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Text') return [children.filter(child => typeof child === 'string').join('')]
  return children.flatMap(lines)
}

// One fake gh: every process.run answers `result` and is recorded, so a test can see the pane ran only `gh pr list`.
const setup = (on: Parameters<Parameters<typeof test>[1]>[1], result: { exitCode: number; stdout: string; stderr: string }) => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('session.cwd', () => ({ value: '/repo' }))
  const calls: string[][] = []
  on('process.run', (_$, e) => { calls.push([...e.argv]); return { value: result } as never })
  return { clock, calls }
}

test('/draft-prs lists drafts, then ready, then merged in the last 7 days, from one gh pr list', async ($, on) => {
  const { calls } = setup(on, { exitCode: 0, stdout: JSON.stringify(PRS), stderr: '' })
  await $.command.run(RUN)
  const rows = lines(await $.ui.render(PANE))
  expect(rows[0]).toBe('Draft PRs')
  for (const header of HEADERS) expect(rows).toContain(header)
  for (const row of ROWS) expect(rows).toContain(row)
  // Drafts first under their own header; the branch shows only on the selected PR's detail line.
  expect(rows.indexOf('Draft · 1')).toBeLessThan(rows.indexOf(ROWS[0]))
  expect(rows.indexOf(ROWS[0])).toBeLessThan(rows.indexOf('Ready · 1'))
  expect(rows).toContain('band-icon-only · ')
  expect(rows.some(row => row.includes('pi-reload'))).toBe(false)
  expect(calls).toEqual([[...GH_ARGV]])
})

test('j moves the selection and y copies its url', async ($, on) => {
  const { clock } = setup(on, { exitCode: 0, stdout: JSON.stringify(PRS), stderr: '' })
  const copied: string[] = []
  on('ui.copy', (_$, e) => { copied.push(e.text); return { value: { isCopied: true } } as never })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  expect((await ui.find({ key: 'pr-key-copy' }))?.props.hotkey).toBe('y')
  await ui.press({ key: 'pr-key-down' })
  await clock.settle()
  await ui.press({ key: 'pr-key-copy' })
  await clock.settle()
  expect(copied).toEqual(['https://github.com/vietbui99/dotfiles/pull/117'])
})

test('gh exit 4 shows the login message instead of rows', async ($, on) => {
  setup(on, { exitCode: 4, stdout: '', stderr: 'To get started with GitHub CLI, please run:  gh auth login' })
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE))).toContain(GH_AUTH)
})
