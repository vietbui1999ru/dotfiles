import type { On } from 'claude-code'
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
}

const review = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1', owner: '/work', branch: 'feat/x', name: '', startedAt: '2026-10-23T10:00:00.000Z',
  processing: false, error: false, landed: false, decided: false, orphan: false, ...over,
})

const setup = (on: On, over: Partial<World> = {}): World => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const world: World = { files: {}, list: JSON.stringify([review()]), diffs: {}, status: 3, calls: [], toasts: [], clock, ...over }
  mock.env(on, { HOME: '/h', TMPDIR: '/tmp' })
  on('ui.open', () => ({ value: { isPlaced: true } } as never))
  on('ui.toast', (_$, e) => { world.toasts.push(String((e as { text?: unknown }).text ?? '')); return { value: undefined } as never })
  on('session.cwd', () => ({ value: '/work' }))
  on('fs.read', (_$, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
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
    if (argv[0]?.endsWith('/ac-run') && argv[1] === 'status') return { value: { ...OK, exitCode: world.status, stdout: world.status === 0 ? 'approved' : 'draft' } } as never
    if (argv[0]?.endsWith('/ac-run') && argv[1] === 'show') return { value: { ...OK, stdout: 'AC-1: draw the pane\n    runs: true\n' } } as never
    if (argv.includes('rev-parse') && argv.includes('--show-toplevel')) return { value: { ...OK, stdout: '/work\n' } } as never
    if (argv.includes('rev-parse') && argv.includes('--abbrev-ref')) return { value: { ...OK, stdout: 'feat/x\n' } } as never
    if (argv[0] === 'git' && argv.includes('diff')) {
      const file = argv[argv.length - 1] ?? ''
      return { value: { ...OK, stdout: world.diffs[file] ?? '' } } as never
    }
    if (argv[0]?.endsWith('/floor-guard')) return { value: { ...OK, exitCode: 1, stdout: '' } } as never
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
