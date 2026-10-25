import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { agentBusy, landPatch, overruleTrailer } from './review-land'
import { parseThread, threadFile, type ThreadEntry } from './review-thread'

const OK = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const FAIL = { ...OK, exitCode: 1 }

const DIFF = [
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-old',
  '+new',
  '',
].join('\n')

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: 'p1',
  at: '2026-10-23T10:00:00.000Z',
  agent: 'claude:c2',
  file: 'src/a.ts',
  kind: 'patch',
  author: 'person',
  text: 'edit',
  patch: DIFF,
  ...over,
})

type Call = { argv: string[]; cwd?: string; stdin?: string }
type World = { files: Record<string, string>; calls: Call[]; applyCheck: number; funnel: number; agents: unknown[]; pueue: string }

const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = { files: {}, calls: [], applyCheck: 0, funnel: 0, agents: [], pueue: '{"tasks":{}}', ...over }
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/h', TMPDIR: '/tmp' })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's1' }))
  on('turn.start', () => ({ value: { turnId: 't1' } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('fs.read', (_$, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', (_$, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('process.run', (_$, e) => ({ value: run(world, e.argv, e.init?.stdin, e.init?.cwd) } as never))
  return world
}

const run = (world: World, argv: readonly string[], stdin?: string, cwd?: string) => {
  world.calls.push({ argv: [...argv], stdin, cwd })
  if (argv[0] === 'git' && argv.includes('apply')) {
    const check = argv.includes('--check')
    return check ? { ...OK, exitCode: world.applyCheck } : { ...OK }
  }
  if (argv[0]?.endsWith('/commit-funnel')) return { ...OK, exitCode: world.funnel }
  if (argv[0] === 'pueue' && argv[1] === 'status') return { ...OK, stdout: world.pueue }
  if (argv[0] === 'claude' && argv[1] === 'agents') return { ...OK, stdout: JSON.stringify(world.agents) }
  const [cmd, flag, from, to] = argv
  if (cmd === 'mv' && flag === '-f' && from && to && from in world.files) {
    world.files[to] = world.files[from] as string
    delete world.files[from]
    return OK
  }
  return FAIL
}

// The test body's `$` carries no file system, process or session: the data layer gets the
// engine's contract instead, over the same in-memory world the hooks are mocked with.
const engine = (world: World): EngineInterface => ({
  env: { get: async (name: string) => name === 'HOME' ? '/h' : name === 'TMPDIR' ? '/tmp' : undefined },
  fs: {
    read: async (path: string) => {
      if (!(path in world.files)) throw new Error('ENOENT')
      return world.files[path] as string
    },
    write: async (path: string, text: string) => { world.files[path] = text },
  },
  process: { run: async (argv: readonly string[], init?: { stdin?: string; cwd?: string }) => run(world, argv, init?.stdin, init?.cwd) },
  clock: { now: async () => 1_000_000 },
  state: { get: async () => ({ value: undefined }), set: async () => undefined },
  session: { id: async () => 's1', cwd: async () => '/work' },
} as unknown as EngineInterface)

const thread = (world: World, agent = 'claude:c2') => parseThread(world.files[threadFile('/work', agent, 'src/a.ts')] ?? '')

test('an agreed patch lands and commits through commit-funnel', async ($, on) => {
  const world = setup(on)
  const patch = entry()
  const result = await landPatch(engine(world), '/work', patch)
  expect(result).toBe('landed')
  expect(world.calls.filter(call => call.argv[0] === 'git')).toEqual([
    { argv: ['git', '-C', '/work', 'apply', '--check'], cwd: undefined, stdin: DIFF },
    { argv: ['git', '-C', '/work', 'apply'], cwd: undefined, stdin: DIFF },
  ])
  const funnel = world.calls.find(call => call.argv[0] === '/h/dotfiles/scripts/commit-funnel')
  expect(funnel?.argv.slice(0, 4)).toEqual(['/h/dotfiles/scripts/commit-funnel', '--worktree', '/work', '-F'])
  expect(funnel?.argv[5]).toBe('src/a.ts')
  expect(funnel?.cwd).toBe('/work')
  expect(world.files[funnel?.argv[4] ?? '']).toBe('review: apply agreed patch to src/a.ts\n')
  const entries = thread(world)
  expect(entries.some(item => item.kind === 'system' && item.text === 'patch landed' && item.replyTo === 'p1')).toBe(true)
})

test('an overrule commit carries the trailer', async ($, on) => {
  const world = setup(on)
  const patch = entry()
  const clapback = entry({ id: 'c1', kind: 'clapback', author: 'agent', text: 'drops the error handling the caller relies on' })
  expect(await landPatch(engine(world), '/work', patch, clapback)).toBe('landed')
  const funnel = world.calls.find(call => call.argv[0] === '/h/dotfiles/scripts/commit-funnel')
  expect(world.files[funnel?.argv[4] ?? '']).toBe([
    'review: apply overruled patch to src/a.ts',
    '',
    'Overruled: agent warned "drops the error handling the caller relies on"',
    '',
  ].join('\n'))
  const entries = thread(world)
  expect(entries.find(item => item.kind === 'overrule')?.text).toBe('Overruled: agent warned "drops the error handling the caller relies on"')
  expect(entries.some(item => item.kind === 'system' && item.text === 'patch landed')).toBe(true)
  expect(overruleTrailer('x'.repeat(300))).toBe(`Overruled: agent warned "${'x'.repeat(200)}"`)
})

test('a stale patch reports conflict and stays proposed', async ($, on) => {
  const world = setup(on, { applyCheck: 1 })
  const patch = entry()
  world.files[threadFile('/work', 'claude:c2', 'src/a.ts')] = `${JSON.stringify(patch)}\n`
  expect(await landPatch(engine(world), '/work', patch)).toBe('conflict')
  expect(world.calls.some(call => call.argv[0] === '/h/dotfiles/scripts/commit-funnel')).toBe(false)
  const entries = thread(world)
  expect(entries.some(item => item.kind === 'patch' && item.id === 'p1')).toBe(true)
  expect(entries.some(item => item.kind === 'system' && item.text === 'patch no longer applies' && item.replyTo === 'p1')).toBe(true)
})

test('a busy agent makes landing wait', async ($, on) => {
  const world = setup(on)
  world.agents = [{ sessionId: 'c2', state: 'working' }]
  expect(await agentBusy(engine(world), 'claude:c2')).toBe(true)
  expect(await landPatch(engine(world), '/work', entry({ id: 'p2', agent: 'claude:c2' }))).toBe('waiting')
  expect(world.calls.filter(call => call.argv[0] === 'git')).toEqual([])
  world.agents = [{ sessionId: 'c2', state: 'idle' }]
  expect(await landPatch(engine(world), '/work', entry({ id: 'p3', agent: 'claude:c2' }))).toBe('landed')

  // A Pi session with a Running pueue task waits the same way.
  const before = world.calls.filter(call => call.argv[0] === 'git').length
  world.pueue = JSON.stringify({ tasks: { '1': { id: 1, label: 'pi', command: "pi --session-id 'pi-s1' -p x", path: '/work', status: { Running: {} } } } })
  expect(await landPatch(engine(world), '/work', entry({ id: 'p4', agent: 'pi:pi-s1' }))).toBe('waiting')
  expect(world.calls.filter(call => call.argv[0] === 'git')).toHaveLength(before)
  world.pueue = '{"tasks":{}}'
  expect(await landPatch(engine(world), '/work', entry({ id: 'p5', agent: 'pi:pi-s1' }))).toBe('landed')
})
