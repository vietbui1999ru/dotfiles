import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const, surface: 'terminal' as const, requestId: 'gates',
  props: { title: 'Gates', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 30 }, view: {} },
}
const RUN = { command: 'gates', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const OK = { exitCode: 0, stdout: '', stderr: '' }
const lines = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Text') return [children.filter(child => typeof child === 'string').join('')]
  return children.flatMap(lines)
}

const setup = (on: Parameters<Parameters<typeof test>[1]>[1], state = 'draft', hold = false, reviews = { ...OK, stdout: '[]' }, approval = '{"ok":true}') => {
  const clock = mock.clock(on, { now: 1000 })
  mock.env(on, { HOME: '/h', TMPDIR: '/tmp', USER: 'test' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('session.cwd', () => ({ value: '/r/w' }))
  on('fs.read', (_$, e) => ({ value: e.path === '/r/w/SPEC.md' ? '---\nbranch: feat/w\n---\n' : e.path === '/r/SPEC.md' ? '---\nbranch: main\n---\n' : '' }))
  on('fs.list', () => ({ value: [] } as never))
  const calls: { argv: string[]; cwd?: string; timeoutMs?: number }[] = []
  let release: (() => void) | undefined
  const waiting = new Promise<void>(resolve => { release = resolve })
  let started: (() => void) | undefined
  const reached = new Promise<void>(resolve => { started = resolve })
  on('process.run', async (_$, e) => {
    calls.push({ argv: [...e.argv], cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
    if (e.argv[0] === 'git') return { value: { ...OK, stdout: 'worktree /r/w\nHEAD abc\nbranch refs/heads/feat/w\n\nworktree /r\nHEAD def\nbranch refs/heads/main\n' } } as never
    if (e.argv[0]?.endsWith('/ac-run')) {
      if (e.argv[1] === 'status') {
        const status = e.init?.cwd === '/r' ? 'approved' : state
        return { value: { exitCode: status === 'approved' ? 0 : status === 'invalid' ? 2 : 3, stdout: status, stderr: status === 'invalid' ? 'bad spec' : '' } } as never
      }
      if (e.argv[1] === 'show') return { value: { ...OK, stdout: 'Approve SPEC.md\n    runs: true\n    runs: false\n' } } as never
      if (e.argv[1] === 'approve') {
        started?.()
        if (hold) await waiting
        return { value: { ...OK, stdout: 'approved: fixture record\n' } } as never
      }
    }
    if (e.argv[0]?.endsWith('/agent-review')) {
      if (e.argv[1] === 'list') return { value: reviews } as never
      return { value: { ...OK, stdout: e.argv[1] === 'approve' ? approval : '{"message":"Skipped."}' } } as never
    }
    if (e.argv[0] === 'fd') return { value: { ...OK, stdout: '/tmp/nvim.test/nvim.1.0\n' } } as never
    if (e.argv.includes('--remote-expr')) return { value: { ...OK, stdout: '/r/w' } } as never
    return { value: OK } as never
  })
  return { clock, calls, release: () => release?.(), reached }
}

const review = (over: Record<string, unknown> = {}) => ({ runId: 'run-12345678', owner: '/r/w', branch: 'feat/w', name: 'build', startedAt: '', processing: false, error: false, landed: true, orphan: false, ...over })

test('gates unavailable reviews leave spec rows visible for failed and malformed replies', async ($, on) => {
  const response = { exitCode: 1, stdout: '', stderr: 'failed' }
  const { clock } = setup(on, 'draft', false, response)
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE))).toContain('reviews unavailable')
  expect(lines(await $.ui.render(PANE))).toContain('› SPEC.md  draft')
  response.exitCode = 0
  response.stdout = '{"not":"an array"}'
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-key-reload' })
  await clock.settle()
  expect(lines(await $.ui.render(PANE))).toContain('reviews unavailable')
  expect(lines(await $.ui.render(PANE))).toContain('› SPEC.md  draft')
})

test('gates groups an owned review under its worktree and approves from session cwd', async ($, on) => {
  const { clock, calls } = setup(on, 'draft', false, { ...OK, stdout: JSON.stringify([review()]) })
  on('ui.toast', () => ({ value: undefined } as never))
  await $.command.run(RUN)
  const rows = lines(await $.ui.render(PANE))
  expect(rows).toContain('  review run-1234  build  [landed]')
  expect(rows.indexOf('feat/w')).toBeLessThan(rows.indexOf('  review run-1234  build  [landed]'))
  expect(rows.indexOf('  review run-1234  build  [landed]')).toBeLessThan(rows.indexOf('main'))
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-key-down' })
  await clock.settle()
  await ui.press({ key: 'gates-approve' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'approve')).toEqual([{ argv: ['/h/dotfiles/scripts/agent-review', 'approve', 'run-12345678'], cwd: '/r/w', timeoutMs: 60000 }])
  expect(calls.filter(call => call.argv[1] === 'list').every(call => call.cwd === '/r/w')).toBe(true)
})

test('gates processing reviews do not approve or edit', async ($, on) => {
  const { clock, calls } = setup(on, 'draft', false, { ...OK, stdout: JSON.stringify([review({ processing: true })]) })
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-key-down' })
  await clock.settle()
  await ui.press({ key: 'gates-approve' })
  await ui.press({ key: 'gates-edit' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'approve' || call.argv[0] === 'nvim')).toEqual([])
})

test('gates orphans skip only after two presses and cannot approve or open', async ($, on) => {
  const { clock, calls } = setup(on, 'draft', false, { ...OK, stdout: JSON.stringify([review({ owner: null, orphan: true })]) })
  on('ui.toast', () => ({ value: undefined } as never))
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE))).toContain('(no worktree)')
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-key-up' })
  await clock.settle()
  await ui.press({ key: 'gates-approve' })
  await ui.press({ key: 'gates-open' })
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  expect(calls.filter(call => ['skip', 'approve'].includes(call.argv[1]!) || call.argv[0] === 'nvim')).toEqual([])
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'skip')).toEqual([{ argv: ['/h/dotfiles/scripts/agent-review', 'skip', 'run-12345678'], cwd: '/r/w', timeoutMs: undefined }])
})

test('gates tree-changed approval opens owner review and normal reject sends Neovim RejectAll', async ($, on) => {
  const { clock, calls } = setup(on, 'draft', false, { ...OK, stdout: JSON.stringify([review()]) }, '{"ok":false,"reason":"tree-changed"}')
  on('ui.toast', () => ({ value: undefined } as never))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-key-down' })
  await clock.settle()
  await ui.press({ key: 'gates-approve' })
  await clock.settle()
  expect(calls.some(call => call.argv[4] === '<C-\\><C-N>:AgentReview<CR>')).toBe(true)
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  expect(calls.some(call => call.argv[4] === '<C-\\><C-N>:AgentReviewRejectAll run-12345678<CR>')).toBe(true)
})

test('/gates lists each worktree matching spec with state and full verify detail', async ($, on) => {
  setup(on)
  await $.command.run(RUN)
  const rows = lines(await $.ui.render(PANE))
  expect(rows).toContain('feat/w')
  expect(rows).toContain('main')
  expect(rows).toContain('› SPEC.md  draft')
  expect(rows).toContain('  SPEC.md  approved')
  expect(rows).toContain('    runs: true')
})

test('gates approve runs in the spec worktree with baseline timeout', async ($, on) => {
  const { clock, calls } = setup(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-approve' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'approve')).toEqual([{ argv: ['/h/dotfiles/scripts/ac-run', 'approve', '/r/w/SPEC.md'], cwd: '/r/w', timeoutMs: 345000 }])
})

test('gates second approve while one runs starts no second process', async ($, on) => {
  const { clock, calls, release, reached } = setup(on, 'draft', true)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-approve' })
  await reached
  await ui.press({ key: 'gates-approve' })
  expect(calls.filter(call => call.argv[1] === 'approve').length).toBe(1)
  release()
  await clock.settle()
})

test('gates invalid and approved specs do not approve', async ($, on) => {
  const { clock, calls } = setup(on, 'invalid')
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-approve' })
  await clock.settle()
  await ui.press({ key: 'gates-key-down' })
  await clock.settle()
  await ui.press({ key: 'gates-approve' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'approve')).toEqual([])
})

test('gates reject needs a second press', async ($, on) => {
  const { clock, calls } = setup(on)
  on('ui.toast', () => ({ value: undefined } as never))
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'reject')).toEqual([])
  await ui.press({ key: 'gates-reject' })
  await clock.settle()
  expect(calls.filter(call => call.argv[1] === 'reject')).toEqual([{ argv: ['/h/dotfiles/scripts/ac-run', 'reject', '/r/w/SPEC.md'], cwd: '/r/w', timeoutMs: undefined }])
})

test('gates edit uses the owner socket and all pane keys are bound', async ($, on) => {
  const { clock, calls } = setup(on)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  for (const [key, hotkey] of [['down', 'j'], ['up', 'k'], ['reload', 'r'], ['prev', 'b'], ['next', 'f'], ['worktrees', 'w'], ['quit', 'q']]) expect((await ui.find({ key: `gates-key-${key}` }))?.props.hotkey).toBe(hotkey)
  for (const [key, hotkey] of [['approve', 'a'], ['reject', 'x'], ['edit', 'e'], ['open', 'o']]) expect((await ui.find({ key: `gates-${key}` }))?.props.hotkey).toBe(hotkey)
  await ui.press({ key: 'gates-edit' })
  await clock.settle()
  expect(calls.some(call => call.argv[4] === '<C-\\><C-N>:edit /r/w/SPEC.md<CR>')).toBe(true)
})
