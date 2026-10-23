import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { approveSession, changedPaths, ensureSessionBase, readSession, snapshotTree, statePath } from './review-touch'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const HOME = '/Users/test'
const STATE = statePath(HOME, 's1')
const INDEX = 'tree-'

type Call = { argv: readonly string[]; env?: Record<string, string> }

const ok = (stdout = '') => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })
const failed = { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false }

type World = {
  files: Record<string, string>
  changed: string[]
  envs: (string | undefined)[]
  snapshots: number
  writes: number
}

const runGit = (world: World, argv: readonly string[], env?: Record<string, string>) => {
  if (argv[0] !== 'git') return ok()
  switch (argv[3]) {
    case 'rev-parse': return ok('/work\n')
    case 'add': world.envs.push(env?.GIT_INDEX_FILE); return ok()
    case 'rm': world.envs.push(env?.GIT_INDEX_FILE); return ok()
    case 'write-tree':
      world.envs.push(env?.GIT_INDEX_FILE)
      world.snapshots += 1
      return ok(`${INDEX}${world.snapshots}\n`)
    case 'diff': return ok(world.changed.join('\n'))
    default: return ok()
  }
}

const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = { files: {}, changed: [], envs: [], snapshots: 0, writes: 0, ...over }
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME, TMPDIR: '/tmp' })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 0 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', ($, e) => ({ value: runGit(world, e.argv, e.init?.env) }))
  on('fs.read', ($, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', ($, e) => {
    world.writes += 1
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      const question = (e as { questions: { question: string }[] }).questions[0]?.question ?? ''
      return { result: { answers: { [question]: 'Allow' } } } as never
    }
    return { result: 'ok', text: 'ok' } as never
  })
  return world
}

// The test body's `$` carries no file system, process or clock: the data layer gets one with the
// engine's contract instead, over the same in-memory world the hooks are mocked with.
const engine = (world: World): EngineInterface => ({
  env: { get: async (name: string) => name === 'HOME' ? HOME : name === 'TMPDIR' ? '/tmp' : undefined },
  fs: {
    read: async (path: string) => {
      if (!(path in world.files)) throw new Error('ENOENT')
      return world.files[path] as string
    },
    write: async (path: string, text: string) => {
      world.writes += 1
      world.files[path] = text
    },
  },
  process: {
    run: async (argv: readonly string[], init?: { env?: Record<string, string> }) => runGit(world, argv, init?.env),
  },
  clock: { now: async () => 1_000_000 },
  session: { cwd: async () => '/work', id: async () => 's1' },
} as unknown as EngineInterface)

const touched = (world: World) => JSON.parse(world.files[STATE] ?? '{"touched":[]}').touched as string[]

// A session whose base was taken before the call under test.
const seeded = (world: World) => {
  world.files[STATE] = JSON.stringify({ sessionId: 's1', worktree: '/work', baseTree: 'tree-0', touched: [] })
}

const edit = async ($: EngineInterface, path: string) => {
  await $.tool.call({ tool: 'Edit', file_path: path, old_string: 'a', new_string: 'b' })
}

test('the session state lives outside the repo', () => {
  expect(statePath(HOME, 's1')).toBe('/Users/test/.local/state/session-band/review/s1.json')
})

test('an Edit records its file once', async ($, on) => {
  const world = setup(on)

  await edit($, '/work/a.ts')
  await edit($, '/work/a.ts')

  expect(touched(world)).toEqual(['a.ts'])
  expect(JSON.parse(world.files[STATE]!).worktree).toBe('/work')
  expect(JSON.parse(world.files[STATE]!).baseTree).toBe('tree-1')
})

test('a Write records its file too', async ($, on) => {
  const world = setup(on)

  await $.tool.call({ tool: 'Write', file_path: '/work/src/b.ts', content: 'x' })

  expect(touched(world)).toEqual(['src/b.ts'])
})

test('a Bash call that changes nothing records nothing', async ($, on) => {
  const world = setup(on)
  seeded(world)

  await $.tool.call({ tool: 'Bash', command: 'ls -la' })

  expect(touched(world)).toEqual([])
  expect(world.files[STATE]).toBeDefined()
  expect(world.writes).toBe(0)
})

test('a Bash call that deletes b.ts records b.ts', async ($, on) => {
  const world = setup(on, { changed: ['b.ts'] })
  seeded(world)
  await $.session.start(START)

  await $.tool.call({ tool: 'Bash', command: 'rm ./b.ts' })

  expect(touched(world)).toEqual(['b.ts'])
})

test('edits under .pi are never recorded', async ($, on) => {
  const world = setup(on)

  await edit($, '/work/.pi/agent-review/threads/x.jsonl')

  expect(world.files[STATE]).toBeUndefined()
})

test('snapshotTree builds the tree in a throwaway index and leaves the real one alone', async () => {
  const calls: Call[] = []
  const $ = {
    env: { get: async () => '/tmp' },
    process: {
      run: async (argv: readonly string[], init?: { env?: Record<string, string> }) => {
        calls.push({ argv, env: init?.env })
        return ok(argv.includes('write-tree') ? 'tree-9\n' : '')
      },
    },
  } as unknown as EngineInterface

  expect(await snapshotTree($, '/work')).toBe('tree-9')

  const gitCalls = calls.filter(call => call.argv[0] === 'git')
  expect(gitCalls.map(call => call.argv[3])).toEqual(['rev-parse', 'add', 'rm', 'write-tree'])
  for (const call of gitCalls.slice(1)) {
    expect(call.env?.GIT_INDEX_FILE?.startsWith('/tmp/')).toBe(true)
    expect(call.env?.GIT_INDEX_FILE).not.toContain('.git/index')
  }
  expect(new Set(gitCalls.slice(1).map(call => call.env?.GIT_INDEX_FILE)).size).toBe(1)
  expect(calls.at(-1)?.argv).toEqual(['rm', '-f', gitCalls[1]?.env?.GIT_INDEX_FILE])
})

test('snapshotTree refuses a worktree whose add fails', async () => {
  const $ = {
    env: { get: async () => '/tmp' },
    process: { run: async () => failed },
  } as unknown as EngineInterface

  await expect(snapshotTree($, '/work')).rejects.toThrow('git add')
})

test('changedPaths reads the names git prints and is empty on a failed diff', async () => {
  const seen: (readonly string[])[] = []
  const $ = {
    process: {
      run: async (argv: readonly string[]) => {
        seen.push(argv)
        return argv.includes('diff') ? ok('a.ts\nb.ts\n') : ok('/work\n')
      },
    },
  } as unknown as EngineInterface

  expect(await changedPaths($, '/work', 'tree-1', 'tree-2')).toEqual(['a.ts', 'b.ts'])
  expect(seen.find(argv => argv.includes('diff'))).toEqual(['git', '-C', '/work', 'diff', '--name-only', '--no-renames', 'tree-1', 'tree-2'])

  const broken = { process: { run: async () => failed } } as unknown as EngineInterface
  expect(await changedPaths(broken, '/work', 'tree-1', 'tree-2')).toEqual([])
})

test('approval clears touched and moves the base', async ($, on) => {
  const world = setup(on)
  world.files[STATE] = JSON.stringify({ sessionId: 's1', worktree: '/work', baseTree: 'tree-0', touched: ['a.ts'], approvedAt: '2026-10-01T00:00:00.000Z' })

  const approved = await approveSession(engine(world), 's1')

  expect(approved.touched).toEqual([])
  expect(approved.baseTree).toBe('tree-1')
  expect(approved.approvedAt).toBe(new Date(1_000_000).toISOString())
  expect(await readSession(engine(world), 's1')).toEqual(approved)
})

test('a file touched after approval appears again', async ($, on) => {
  const world = setup(on)
  world.files[STATE] = JSON.stringify({ sessionId: 's1', worktree: '/work', baseTree: 'tree-0', touched: ['a.ts'] })

  await approveSession(engine(world), 's1')
  await edit($, '/work/b.ts')

  expect((await readSession(engine(world), 's1'))?.touched).toEqual(['b.ts'])
})

test('session start takes the first snapshot as the base when none exists', async ($, on) => {
  const world = setup(on)

  await $.session.start(START)

  expect(JSON.parse(world.files[STATE]!).baseTree).toBe('tree-1')
  expect(JSON.parse(world.files[STATE]!).touched).toEqual([])
})

test('session start keeps an existing base', async ($, on) => {
  const world = setup(on)
  world.files[STATE] = JSON.stringify({ sessionId: 's1', worktree: '/work', baseTree: 'tree-stable', touched: ['a.ts'] })

  await $.session.start(START)

  expect(world.snapshots).toBe(0)
  expect(JSON.parse(world.files[STATE]!).baseTree).toBe('tree-stable')
  expect(JSON.parse(world.files[STATE]!).touched).toEqual(['a.ts'])
})

test('ensureSessionBase leaves an existing session alone', async ($, on) => {
  const world = setup(on)
  world.files[STATE] = JSON.stringify({ sessionId: 's1', worktree: '/work', baseTree: 'tree-stable', touched: [] })

  await ensureSessionBase(engine(world), 's1', '/work')

  expect(world.snapshots).toBe(0)
  expect(JSON.parse(world.files[STATE]!).baseTree).toBe('tree-stable')
})

test('an absent session state reads as undefined', async ($, on) => {
  const world = setup(on)

  expect(await readSession(engine(world), 'nobody')).toBeUndefined()
})
