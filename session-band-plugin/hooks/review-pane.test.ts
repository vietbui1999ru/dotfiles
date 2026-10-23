import type { On } from 'claude-code'

import { parseQueue, queueFile } from './review-batch'
import { threadFile } from './review-thread'
import { statePath } from './review-touch'
import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  component: 'Pane' as const,
  surface: 'terminal' as const,
  requestId: 'review',
  props: { title: 'Review', isFocused: true, bodyColumns: 120, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 40 }, view: {} },
}
const RUN = { command: 'diff-review', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 120 } }
const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const FAIL = { ...OK, exitCode: 1 }

const lines = (node: unknown): string[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: { children?: unknown } }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Text') return [children.filter(child => typeof child === 'string').join('')]
  return children.flatMap(lines)
}

const codes = (node: unknown): { source: string; format?: string; path?: string }[] => {
  if (!node || typeof node !== 'object') return []
  const value = node as { type?: string; children?: unknown[]; props?: Record<string, unknown> }
  const children = [...(value.children ?? []), ...(value.props?.children === undefined ? [] : Array.isArray(value.props.children) ? value.props.children : [value.props.children])]
  if (value.type === 'Code') return [{ source: String(value.props?.source ?? ''), format: value.props?.format as string | undefined, path: value.props?.path as string | undefined }]
  return children.flatMap(codes)
}

type World = {
  files: Record<string, string>
  list: string
  diffs: Record<string, string>
  status: number
  calls: { argv: string[]; cwd?: string }[]
  toasts: string[]
  clock: ReturnType<typeof mock.clock>
  approval: { exitCode: number; stdout: string; stderr: string; isStdoutTruncated: boolean; isStderrTruncated: boolean }
  applyCheck: number
}

const review = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1', owner: '/work', branch: 'feat/x', name: '', startedAt: '2026-10-23T10:00:00.000Z',
  processing: false, error: false, landed: false, decided: false, orphan: false, ...over,
})

const setup = (on: On, over: Partial<World> = {}): World => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world: World = { files: {}, list: JSON.stringify([review()]), diffs: {}, status: 3, calls: [], toasts: [], clock, approval: OK, applyCheck: 0, ...over }
  mock.env(on, { HOME: '/h', TMPDIR: '/tmp' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', (_$, e) => { world.toasts.push(String((e as { text?: unknown }).text ?? '')); return { value: undefined } as never })
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', (_$, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', (_$, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', (_$, e) => {
    const dir = (e.path ?? '').replace(/\/+$/, '')
    return {
      value: Object.keys(world.files)
        .filter(path => path.startsWith(`${dir}/`))
        .map(path => {
          const name = path.slice(dir.length + 1)
          return { name, kind: name.includes('/') ? 'other' : 'file', size: 1, mtimeMs: 0, isLink: false }
        }) as never,
    }
  })
  on('process.run', ($, e) => {
    world.calls.push({ argv: [...e.argv], cwd: e.init?.cwd })
    const argv = e.argv
    if (argv[0]?.endsWith('/agent-review') && argv[1] === 'list') return { value: { ...OK, stdout: world.list } } as never
    if (argv[0]?.endsWith('/agent-review') && argv[1] === 'approve') return { value: world.approval } as never
    if (argv[0]?.endsWith('/ac-run') && argv[1] === 'approve') return { value: { ...OK, stdout: 'approved: fixture record\n' } } as never
    if (argv[0] === 'git' && (argv.includes('add') || argv.includes('rm'))) return { value: OK } as never
    if (argv[0] === 'git' && argv.includes('write-tree')) return { value: { ...OK, stdout: 'tree2\n' } } as never
    if (argv[0] === 'git' && argv.includes('apply')) return { value: world.applyCheck === 0 ? OK : { ...OK, exitCode: 1 } } as never
    if (argv[0]?.endsWith('/commit-funnel')) return { value: OK } as never
    if (argv[0] === 'pueue' && argv[1] === 'status') return { value: { ...OK, stdout: '{"tasks":{}}' } } as never
    if (argv[0]?.endsWith('/ac-run') && argv[1] === 'status') return { value: { ...OK, exitCode: world.status, stdout: world.status === 0 ? 'approved' : 'draft' } } as never
    if (argv[0]?.endsWith('/ac-run') && argv[1] === 'show') return { value: { ...OK, stdout: 'AC-1: draw the pane\n    runs: true\n' } } as never
    if (argv.includes('rev-parse') && argv.includes('--show-toplevel')) return { value: { ...OK, stdout: '/work\n' } } as never
    if (argv.includes('rev-parse') && argv.includes('--abbrev-ref')) return { value: { ...OK, stdout: 'feat/x\n' } } as never
    if (argv[0] === 'git' && argv.includes('diff')) {
      const file = argv[argv.length - 1] ?? ''
      return { value: { ...OK, stdout: world.diffs[file] ?? '' } } as never
    }
    if (argv[0]?.endsWith('/floor-guard')) return { value: { ...OK, exitCode: 1, stdout: '' } } as never
    const [cmd, flag, from, to] = argv
    if (cmd === 'mv' && flag === '-f' && from && to && from in world.files) {
      world.files[to] = world.files[from] as string
      delete world.files[from]
      return { value: OK } as never
    }
    return { value: FAIL } as never
  })
  return world
}

const piRecord = (over: Record<string, unknown> = {}) => JSON.stringify({
  runId: 'run-1', base: 'base1', baseTree: 'baseTree1', end: 'end1', endTree: 'endTree1',
  files: [{ file: 'src/a.ts' }, { file: 'src/b.ts' }], startedAt: '2026-10-23T10:00:00.000Z',
  endedAt: '2026-10-23T10:01:00.000Z', modeMtimeMs: 1, session: 'pi-s1', ...over,
})
const claudeState = (over: Record<string, unknown> = {}) => JSON.stringify({
  sessionId: 'c1', worktree: '/work', baseTree: 'tree1', touched: ['src/c.ts', 'src/a.ts'], ...over,
})

const seedAgents = (world: World) => {
  world.files['/work/.pi/agent-review/pending/run-1.json'] = piRecord()
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
}

test('one tab per agent file, Pi and Claude together', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  await $.command.run(RUN)
  const rows = lines(await $.ui.render(PANE)).filter(line => line.includes('  src/'))
  expect(rows).toEqual([
    '› pi run-1  src/a.ts  shared: claude c1',
    '  pi run-1  src/b.ts',
    '  claude c1  src/a.ts  shared: pi run-1',
    '  claude c1  src/c.ts',
  ])
})

test('a tab shows the file diff as a Code diff', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  world.diffs['src/a.ts'] = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,2 +1,3 @@\n context\n-old\n+new\n+added\n'
  await $.command.run(RUN)
  const drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('pi run-1 · src/a.ts · shared with claude c1')
  const diffCodes = codes(drawn)
  expect(diffCodes).toHaveLength(1)
  expect(diffCodes[0]?.format).toBe('diff')
  expect(diffCodes[0]?.path).toBe('src/a.ts')
  expect(diffCodes[0]?.source).toContain('@@ -1,2 +1,3 @@\n context\n-old\n+new\n+added')
})

test('a binary file shows a summary', async ($, on) => {
  const world = setup(on)
  world.files['/work/.pi/agent-review/pending/run-1.json'] = piRecord({ files: [{ file: 'img/logo.png' }] })
  world.diffs['img/logo.png'] = 'diff --git a/img/logo.png b/img/logo.png\nindex 1..2 100644\nBinary files a/img/logo.png and b/img/logo.png differ\n'
  await $.command.run(RUN)
  const drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('img/logo.png: binary file, no diff')
  expect(codes(drawn)).toEqual([])
})

test('a deleted file shows a summary and cannot take a patch', async ($, on) => {
  const world = setup(on)
  world.files['/work/.pi/agent-review/pending/run-1.json'] = piRecord({ files: [{ file: 'src/gone.ts' }] })
  world.diffs['src/gone.ts'] = 'diff --git a/src/gone.ts b/src/gone.ts\ndeleted file mode 100644\n--- a/src/gone.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone\n'
  await $.command.run(RUN)
  const drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('src/gone.ts: deleted, no diff')
  expect(codes(drawn)).toEqual([])
})

test('a long diff is paged by hunk', async ($, on) => {
  const world = setup(on)
  const fill = 'x'.repeat(15000)
  const hunk = (n: number) => `@@ -${n},2 +${n},2 @@\n ${fill}\n-${fill}\n+${fill}`
  const diff = `--- a/big.ts\n+++ b/big.ts\n${[1, 4001, 8001].map(hunk).join('\n')}\n`
  expect(diff.length).toBeGreaterThan(100_000)
  world.files['/work/.pi/agent-review/pending/run-1.json'] = piRecord({ files: [{ file: 'big.ts' }] })
  world.diffs['big.ts'] = diff
  await $.command.run(RUN)
  let drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('hunk 1/3')
  expect(codes(drawn)[0]?.source).toContain('--- a/big.ts\n+++ b/big.ts\n@@ -1,2 +1,2 @@')
  expect(codes(drawn)[0]?.source).not.toContain('@@ -4001,2 +4001,2 @@')
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-key-down' })
  await world.clock.settle()
  drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('hunk 2/3')
  expect(codes(drawn)[0]?.source).toContain('@@ -4001,2 +4001,2 @@')
})

const threadPath = (agent: string, file: string) => `/work/.pi/agent-review/threads/${encodeURIComponent(agent)}/${encodeURIComponent(file)}.jsonl`
const threadOf = (world: World, agent: string, file: string) =>
  (world.files[threadPath(agent, file)] ?? '').split('\n').filter(line => line.trim() !== '').map(line => JSON.parse(line) as Record<string, unknown>)

test('a comment is stored with its line', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  world.diffs['src/a.ts'] = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,2 +20,3 @@\n ctx\n-old\n+new\n'
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-key-comment' })
  await world.clock.settle()
  await ui.input({ key: 'review-comment', text: 'why is this here?' })
  await world.clock.settle()
  const entries = threadOf(world, 'pi:pi-s1', 'src/a.ts')
  expect(entries).toHaveLength(1)
  expect(entries[0]).toMatchObject({ kind: 'comment', author: 'person', text: 'why is this here?', line: 20, agent: 'pi:pi-s1', file: 'src/a.ts' })
  // Nothing was written into a source file: only the thread, and no src/a.ts key exists.
  expect(world.files['src/a.ts']).toBeUndefined()
})

test('a typed edit becomes a patch entry with a unified diff', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  world.diffs['src/a.ts'] = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -10,2 +20,3 @@\n ctx\n-old\n+new\n'
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-key-patch' })
  await world.clock.settle()
  await ui.input({ key: 'review-patch', text: 'ctx\nbrand new' })
  await world.clock.settle()
  const entries = threadOf(world, 'pi:pi-s1', 'src/a.ts')
  expect(entries).toHaveLength(1)
  expect(entries[0]?.kind).toBe('patch')
  expect(entries[0]?.patch).toBe([
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -10,2 +20,2 @@',
    '-ctx',
    '-old',
    '+ctx',
    '+brand new',
    '',
  ].join('\n'))
})

test('threads survive closing and reopening the pane', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  world.diffs['src/a.ts'] = '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n old\n+new\n'
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-key-comment' })
  await world.clock.settle()
  await ui.input({ key: 'review-comment', text: 'survive me' })
  await world.clock.settle()
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('survive me'))).toBe(true)
  await ui.unmount()
  await $.command.run(RUN)
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('survive me'))).toBe(true)
})

const queueOf = (world: World) => parseQueue(world.files[queueFile('/work')] ?? '')

test('send queues one batch per agent', async ($, on) => {
  const world = setup(on)
  world.list = '[]'
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
  const entry = (id: string, file: string, kind: string, text: string) => JSON.stringify({
    id, at: '2026-10-23T10:00:00.000Z', agent: 'claude:c1', file, kind, author: 'person', text,
  }) + '\n'
  world.files[threadFile('/work', 'claude:c1', 'src/a.ts')] = entry('e1', 'src/a.ts', 'comment', 'why?')
  world.files[threadFile('/work', 'claude:c1', 'src/c.ts')] = entry('e2', 'src/c.ts', 'patch', 'edit') + JSON.stringify({
    id: 'e3', at: '2026-10-23T10:01:00.000Z', agent: 'claude:c1', file: 'src/c.ts', kind: 'reply', author: 'agent', text: 'done', batch: 'older',
  }) + '\n'
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-send' })
  await world.clock.settle()
  const queue = queueOf(world)
  expect(queue).toHaveLength(1)
  expect(queue[0]).toMatchObject({ agent: 'claude:c1', entryIds: ['e1', 'e2'], state: 'queued' })
  expect(lines(await $.ui.render(PANE)).filter(line => line.includes('[queued]'))).toHaveLength(1)
  await ui.press({ key: 'review-key-next-tab' })
  await world.clock.settle()
  expect(lines(await $.ui.render(PANE)).filter(line => line.includes('[queued]'))).toHaveLength(1)
})

test('the cycler warns when leaving same as agent', async ($, on) => {
  const world = setup(on)
  world.list = '[]'
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
  world.files[threadFile('/work', 'claude:c1', 'src/a.ts')] = JSON.stringify({
    id: 'e1', at: '2026-10-23T10:00:00.000Z', agent: 'claude:c1', file: 'src/a.ts', kind: 'comment', author: 'person', text: 'why?',
  }) + '\n'
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  let drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('answerer: same as agent')
  expect(lines(drawn)).not.toContain('switching model re-reads the full context (no cache)')
  await ui.press({ key: 'review-key-model' })
  await world.clock.settle()
  drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('answerer: haiku · low')
  expect(lines(drawn)).toContain('switching model re-reads the full context (no cache)')
  await ui.press({ key: 'review-send' })
  await world.clock.settle()
  expect(queueOf(world)[0]).toMatchObject({ model: 'haiku', effort: 'low' })
})

test('an answer marks its tab unread and toasts', async ($, on) => {
  const world = setup(on)
  world.files['/work/.pi/agent-review/pending/run-1.json'] = piRecord()
  world.files[queueFile('/work')] = JSON.stringify({
    id: 'b1', agent: 'pi:pi-s1', entryIds: ['e2'], state: 'answered', queuedAt: '2026-10-23T10:00:00.000Z', answeredAt: '2026-10-23T10:05:00.000Z',
  }) + '\n'
  world.files[threadFile('/work', 'pi:pi-s1', 'src/b.ts')] = [
    { id: 'e1', at: '2026-10-23T10:00:00.000Z', agent: 'pi:pi-s1', file: 'src/b.ts', kind: 'comment', author: 'person', text: 'why?', batch: 'b1' },
    { id: 'e2', at: '2026-10-23T10:05:00.000Z', agent: 'pi:pi-s1', file: 'src/b.ts', kind: 'reply', author: 'agent', text: 'because', batch: 'b1' },
  ].map(entry => JSON.stringify(entry)).join('\n') + '\n'
  await $.command.run(RUN)
  await $.ui.render(PANE)
  expect(world.toasts.some(toast => toast.includes('src/b.ts'))).toBe(true)
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('src/b.ts') && line.includes('unread'))).toBe(true)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-key-next-tab' })
  await world.clock.settle()
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('src/b.ts') && line.includes('unread'))).toBe(false)
})

test('no reply offers resend', async ($, on) => {
  const world = setup(on)
  world.list = '[]'
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
  world.files[queueFile('/work')] = JSON.stringify({
    id: 'b1', agent: 'claude:c1', entryIds: ['e1'], state: 'no-reply', queuedAt: '2026-10-23T10:00:00.000Z', deliveredAt: '2026-10-23T10:01:00.000Z',
  }) + '\n'
  world.files[threadFile('/work', 'claude:c1', 'src/a.ts')] = JSON.stringify({
    id: 'e1', at: '2026-10-23T10:00:00.000Z', agent: 'claude:c1', file: 'src/a.ts', kind: 'comment', author: 'person', text: 'why?', batch: 'b1',
  }) + '\n'
  await $.command.run(RUN)
  const drawn = await $.ui.render(PANE)
  expect(lines(drawn)).toContain('you · comment: why?')
  expect(lines(drawn)).toContain('[no reply]')
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-resend-b1' })
  await world.clock.settle()
  expect(queueOf(world)[0]?.state).toBe('queued')
})

const stateOf = (world: World) => JSON.parse(world.files[statePath('/h', 'c1')] ?? '{}') as Record<string, unknown>

test('Pi approval goes through agent-review approve', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-approve' })
  await world.clock.settle()
  expect(world.calls.filter(call => call.argv[1] === 'approve').map(call => call.argv)).toEqual([
    ['/h/dotfiles/scripts/agent-review', 'approve', 'run-1'],
  ])
  expect(world.calls.find(call => call.argv[1] === 'approve')?.cwd).toBe('/work')
})

test('a Claude session needs two presses', async ($, on) => {
  const world = setup(on)
  world.list = '[]'
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-approve' })
  await world.clock.settle()
  expect(stateOf(world).touched).toEqual(['src/c.ts', 'src/a.ts'])
  expect(lines(await $.ui.render(PANE))).toContain('Press a again to approve claude c1.')
  expect(world.toasts.some(toast => toast.includes('Press a again'))).toBe(true)
  await ui.press({ key: 'review-approve' })
  await world.clock.settle()
  expect(stateOf(world).touched).toEqual([])
  expect(typeof stateOf(world).approvedAt).toBe('string')
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('src/a.ts'))).toBe(false)
})

test('a shared file waits for both agents', async ($, on) => {
  const world = setup(on)
  seedAgents(world)
  await $.command.run(RUN)
  let drawn = lines(await $.ui.render(PANE))
  expect(drawn).toContain('› pi run-1  src/a.ts  shared: claude c1')
  expect(drawn).toContain('  claude c1  src/a.ts  shared: pi run-1')
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  // Move from the Pi tab to the Claude tab on the same file, then approve the Claude session.
  await ui.press({ key: 'review-key-next-tab' })
  await ui.press({ key: 'review-key-next-tab' })
  await world.clock.settle()
  await ui.press({ key: 'review-approve' })
  await ui.press({ key: 'review-approve' })
  await world.clock.settle()
  expect(stateOf(world).touched).toEqual([])
  expect(world.calls.some(call => call.argv[1] === 'approve')).toBe(false)
  // The Pi tab still holds src/a.ts: one agent's approval does not approve the other's change.
  expect(lines(await $.ui.render(PANE))).toContain('› pi run-1  src/a.ts')
  // A on the second press approves the file for every agent that touched it.
  await ui.press({ key: 'review-approve-all' })
  await world.clock.settle()
  expect(lines(await $.ui.render(PANE))).toContain('Press x again to approve src/a.ts for every agent.')
  await ui.press({ key: 'review-approve-all' })
  await world.clock.settle()
  expect(world.calls.filter(call => call.argv[1] === 'approve').map(call => call.argv)).toEqual([
    ['/h/dotfiles/scripts/agent-review', 'approve', 'run-1'],
  ])
})

test('tree-changed is reported, not retried', async ($, on) => {
  const world = setup(on, { approval: { ...OK, stdout: '{"ok":false,"reason":"tree-changed","message":"the working tree changed since the run ended"}' } })
  seedAgents(world)
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-approve' })
  await world.clock.settle()
  expect(lines(await $.ui.render(PANE))).toContain('tree-changed: wait for the re-snapshot; this run is not approved.')
  await $.ui.render(PANE)
  expect(world.calls.filter(call => call.argv[1] === 'approve')).toHaveLength(1)
})

test('returning a Claude file keeps it unapproved and queues a note', async ($, on) => {
  const world = setup(on)
  world.list = '[]'
  world.files['/h/.local/state/session-band/review/c1.json'] = claudeState()
  await $.command.run(RUN)
  const ui = await $.ui.mount({ plugin: 'session-band', ...PANE })
  await ui.press({ key: 'review-return' })
  await world.clock.settle()
  expect(stateOf(world).touched).toEqual(['src/c.ts', 'src/a.ts'])
  const entries = threadOf(world, 'claude:c1', 'src/a.ts')
  const note = entries.find(entry => entry.kind === 'comment')
  expect(note?.text).toBe('Returned for rework: src/a.ts')
  const queue = queueOf(world)
  expect(queue).toHaveLength(1)
  expect(queue[0]?.entryIds).toEqual([note?.id])
  expect(lines(await $.ui.render(PANE)).some(line => line.includes('src/a.ts'))).toBe(true)
})
