import { expect, mock, test } from 'claude-code/testing'

import { GH_ARGV, GH_AUTH } from './draft-prs'
import { HEADERS, NOW, PRS, ROWS } from './draft-prs-fixture'
import { NO_REMOTE, noForge, REMOTE_ARGV } from './forge'
import { GLAB_ARGV } from './gitlab'
import { MRS } from './gitlab-fixture'

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

// One fake git and forge CLI: `git remote get-url origin` prints `origin`, any other process.run answers `result`,
// and every call is recorded, so a test can see which forge command the pane ran.
const setup = (on: Parameters<Parameters<typeof test>[1]>[1], result: { exitCode: number; stdout: string; stderr: string }, origin = 'git@github.com:vietbui99/dotfiles.git') => {
  const clock = mock.clock(on, { now: NOW })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('session.cwd', () => ({ value: '/repo' }))
  const calls: string[][] = []
  on('process.run', (_$, e) => {
    calls.push([...e.argv])
    const remote = e.argv[0] === 'git' ? { exitCode: origin ? 0 : 2, stdout: `${origin}\n`, stderr: origin ? '' : "error: No such remote 'origin'" } : result
    return { value: remote } as never
  })
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
  expect(calls).toEqual([[...REMOTE_ARGV], [...GH_ARGV]])
})

test('a GitLab origin lists MRs from glab, numbered with !', async ($, on) => {
  const { calls } = setup(on, { exitCode: 0, stdout: JSON.stringify(MRS), stderr: '' }, 'https://gitlab.com/group/repo.git')
  await $.command.run(RUN)
  const rows = lines(await $.ui.render(PANE))
  expect(rows).toContain('Draft · 2')
  expect(rows).toContain(`!16 ${'wip parser'.padEnd(44)}  2h`)
  expect(rows).toContain('wip-parser · ')
  expect(calls).toEqual([[...REMOTE_ARGV], [...GLAB_ARGV]])
})

test('an origin on no known forge shows a message and runs no forge command', async ($, on) => {
  const { calls } = setup(on, { exitCode: 0, stdout: '[]', stderr: '' }, 'https://codeberg.org/owner/repo.git')
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE))).toContain(noForge('codeberg.org'))
  expect(calls).toEqual([[...REMOTE_ARGV]])
})

test('no origin remote shows its own message', async ($, on) => {
  const { calls } = setup(on, { exitCode: 0, stdout: '[]', stderr: '' }, '')
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE))).toContain(NO_REMOTE)
  expect(calls).toEqual([[...REMOTE_ARGV]])
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

test('digits jump to another mod pane; the pane\'s own digit does nothing', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const closed: string[] = []
  const opened: { id: string; title: string; focus?: true }[] = []
  on('ui.close', (_$, e) => { closed.push(e.id); return { value: undefined } as never })
  on('ui.open', (_$, e) => {
    const { id, title, focus } = e as { id: string; title: string; focus?: boolean }
    opened.push(focus === true ? { id, title, focus: true } : { id, title })
    return { value: { isPlaced: true } } as never
  })
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'pr-key-jump-3' })
  await clock.settle()
  expect(closed).toEqual(['draft-prs'])
  expect(opened).toEqual([
    { id: 'worktrees', title: 'Worktrees', focus: true },
    { id: 'draft-prs', title: 'Draft PRs' },
  ])
  closed.length = 0
  opened.length = 0
  await ui.press({ key: 'pr-key-jump-4' })
  await clock.settle()
  expect(closed).toEqual([])
  expect(opened).toEqual([])
})
