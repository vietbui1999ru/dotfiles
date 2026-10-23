import type { AgentSpawnArgs, EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { batchDir, parseQueue, queueFile, type Batch } from './review-batch'
import { deliverToPi, deliverToSession, piModelFrom } from './review-deliver'
import { threadDir, threadFile, type ThreadEntry } from './review-thread'

const STARTED = { answer: 'done', durationMs: 10, isAborted: false, turnId: 't1', reason: 'answer' as const }

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: 'e1',
  at: '2026-10-23T10:00:00.000Z',
  agent: 'claude:s1',
  file: 'src/a.ts',
  kind: 'comment',
  author: 'person',
  text: 'why?',
  ...over,
})

const batch = (over: Partial<Batch> = {}): Batch => ({
  id: 'b1',
  agent: 'claude:s1',
  entryIds: ['e1'],
  state: 'queued',
  queuedAt: '2026-10-23T10:00:00.000Z',
  ...over,
})

type World = {
  files: Record<string, string>
  submitted: string[]
  spawns: AgentSpawnArgs[]
  sends: { to: unknown; text: string }[]
  pueue: string[][]
  tasks: unknown
  addFails: boolean
  cwd: string
  clock: ReturnType<typeof mock.clock>
}

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const failed = { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// The engine's file system with a rename, as the queue writes it; the plugin's own hooks stay real.
const setup = (on: On, over: Partial<World> = {}): World => {
  const world = {
    files: {}, submitted: [], spawns: [], sends: [], pueue: [], tasks: { tasks: {} }, addFails: false, cwd: '/work', clock: mock.clock(on, { now: 1_000_000 }), ...over,
  } as World
  const clock = world.clock
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp' })
  on('session.start', ($, e) => ({ cwd: e.cwd } as never))
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 1 }, rateLimits: [] } }))
  on('session.send', ($, e) => {
    world.sends.push({ to: e.to, text: e.text })
    return { isDelivered: true } as never
  })
  on('agent.spawn', ($, e) => {
    world.spawns.push(e)
    return { model: e.model ?? '', agentId: 'a1' } as never
  })
  on('fs.read', ($, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', ($, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  on('fs.list', ($, e) => {
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
  on('fs.exists', ($, e) => ({ value: (e.path in world.files) as never }))
  on('fs.stat', () => { throw new Error('ENOENT') })
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('process.run', ($, e) => {
    // The plugin's own calls around a session start answer enough; pueue is the fake this file watches.
    if (e.argv[0] === 'git') {
      if (e.argv.includes('--show-toplevel')) return { value: { ...ok, stdout: '/work\n' } } as never
      if (e.argv.includes('write-tree')) return { value: { ...ok, stdout: 'tree1\n' } } as never
      if (e.argv.includes('add') || e.argv.includes('rm')) return { value: ok } as never
      return { value: failed } as never
    }
    if (e.argv[0] === 'pueue' && e.argv[1] === 'status') return { value: { ...ok, stdout: JSON.stringify(world.tasks) } } as never
    if (e.argv[0] === 'pueue' && e.argv[1] === 'add') {
      world.pueue.push(e.argv)
      return { value: world.addFails ? { ...failed, stderr: 'Failed to connect to the daemon.' } : { ...ok, stdout: '42\n' } } as never
    }
    const [cmd, flag, from, to] = e.argv
    if (cmd === 'mv' && flag === '-f' && from && to && from in world.files) {
      world.files[to] = world.files[from] as string
      delete world.files[from]
      return { value: ok } as never
    }
    return { value: failed } as never
  })
  on('prompt.submit', ($, e) => {
    world.submitted.push(e.text)
    return { text: e.text } as never
  })
  on('turn.complete', ($, e) => ({ text: e.answer } as never))
  return world
}

const mv = (world: World) => async (argv: readonly string[]) => {
  const [cmd, flag, from, to] = argv
  if (cmd !== 'mv' || flag !== '-f' || !from || !to || !(from in world.files)) return failed
  world.files[to] = world.files[from] as string
  delete world.files[from]
  return ok
}

const seed = (world: { files: Record<string, string> }, batches: readonly Batch[], entries: readonly ThreadEntry[]): void => {
  world.files[queueFile('/work')] = `${batches.map(item => JSON.stringify(item)).join('\n')}\n`
  for (const item of entries) {
    const path = threadFile('/work', item.agent, item.file)
    world.files[path] = `${world.files[path] ?? ''}${JSON.stringify(item)}\n`
  }
}

const states = (world: { files: Record<string, string> }) => parseQueue(world.files[queueFile('/work')] ?? '')

type PiWorld = { files: Record<string, string>; pueue: string[][]; tasks: unknown; addFails: boolean; nowMs: number }

const piEngine = (world: PiWorld): EngineInterface => ({
  clock: { now: async () => world.nowMs },
  env: { get: async () => undefined },
  fs: {
    read: async (path: string) => {
      if (!(path in world.files)) throw new Error('ENOENT')
      return world.files[path] as string
    },
    write: async (path: string, text: string) => { world.files[path] = text },
    list: async (path: string) => Object.keys(world.files)
      .filter(file => file.startsWith(`${path}/`))
      .map(file => ({ name: file.slice(path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
  },
  process: {
    run: async (argv: string[]) => {
      if (argv[0] === 'git' && argv.includes('--show-toplevel')) return { ...ok, stdout: '/work\n' }
      if (argv[0] === 'pueue' && argv[1] === 'status') return { ...ok, stdout: JSON.stringify(world.tasks) }
      if (argv[0] === 'pueue' && argv[1] === 'add') {
        world.pueue.push(argv)
        return world.addFails ? { ...failed, stderr: 'Failed to connect to the daemon.' } : { ...ok, stdout: '42\n' }
      }
      const [cmd, flag, from, to] = argv
      if (cmd === 'mv' && flag === '-f' && from && to && from in world.files) {
        world.files[to] = world.files[from] as string
        delete world.files[from]
        return ok
      }
      return failed
    },
  },
}) as unknown as EngineInterface

const piWorld = (over: Partial<PiWorld> = {}): PiWorld => ({ files: {}, pueue: [], tasks: { tasks: {} }, addFails: false, nowMs: 1_000_000, ...over })

// A pueue status JSON body holding one task, as `pueue status --json` reports it.
const pueueTask = (command: string, state: 'Running' | 'Queued', label = 'pi-task') => ({
  tasks: {
    '7': {
      id: 7, label, path: '/work', command, created_at: '2026-10-23T09:00:00.000Z',
      status: state === 'Running'
        ? { Running: { enqueued_at: '2026-10-23T09:00:00.000Z', start: '2026-10-23T09:00:01.000Z' } }
        : { Queued: { enqueued_at: '2026-10-23T09:00:00.000Z' } },
    },
  },
})

test('queued batches go in as one message after the turn ends, oldest first', async ($, on) => {
  const world = setup(on)
  seed(
    world,
    [batch({ id: 'b2', entryIds: ['e2'], queuedAt: '2026-10-23T10:05:00.000Z' }), batch({ id: 'b1' })],
    [entry({ id: 'e1', text: 'why?' }), entry({ id: 'e2', file: 'src/b.ts', text: 'naming' })],
  )

  await $.turn.complete(STARTED)

  expect(world.submitted).toHaveLength(1)
  expect((world.submitted[0] as string).startsWith('[review-batch b1]')).toBe(true)
  expect((world.submitted[0] as string).indexOf('[review-batch b1]')).toBeLessThan((world.submitted[0] as string).indexOf('[review-batch b2]'))
  expect(world.submitted[0]).toContain('- why?')
  expect(world.submitted[0]).toContain('## src/b.ts')
  expect(states(world).map(item => [item.id, item.state])).toEqual([['b2', 'delivered'], ['b1', 'delivered']])
  expect(states(world).every(item => item.deliveredAt !== undefined)).toBe(true)
  expect(world.spawns).toEqual([])
})

test('a subagent turn end delivers nothing: the batch waits for the main loop', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry()])

  await $.turn.complete({ ...STARTED, agentId: 'a1' })

  expect(world.submitted).toEqual([])
  expect(states(world).map(item => item.state)).toEqual(['queued'])
})

test('a batch whose chosen model differs goes to a fresh answerer with the batch, the diff and the plan', async ($, on) => {
  const world = setup(on)
  seed(world, [batch({ model: 'opus', effort: 'high' })], [entry()])
  world.files['/work/SPEC.md'] = '# The plan\n\nDo the thing.\n'

  await $.turn.complete(STARTED)

  expect(world.submitted).toEqual([])
  expect(world.spawns).toHaveLength(1)
  expect(world.spawns[0]?.model).toBe('opus')
  expect(world.spawns[0]?.prompt).toContain('[review-batch b1]')
  expect(world.spawns[0]?.prompt).toContain('Do the thing.')
  expect(states(world)[0]).toMatchObject({ state: 'delivered', model: 'opus', effort: 'high' })
})

test('a refused send stays queued with its reason, and nothing is lost', async () => {
  const world: World = { files: {}, submitted: [], spawns: [], sends: [] }
  seed(world, [batch({ id: 'b9', agent: 'claude:s2' })], [entry({ agent: 'claude:s2' })])
  const $ = {
    clock: { now: async () => 1_000_000 },
    fs: {
      read: async (path: string) => {
        if (!(path in world.files)) throw new Error('ENOENT')
        return world.files[path] as string
      },
      write: async (path: string, text: string) => { world.files[path] = text },
      list: async (path: string) => Object.keys(world.files)
        .filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
        .map(name => ({ name: name.slice(path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    },
    process: { run: mv(world) },
    session: {
      send: async (args: { to: unknown; text: string }) => {
        world.sends.push(args)
        return { isDelivered: false as const, reason: 'no running session by that id' }
      },
    },
  } as unknown as EngineInterface

  await deliverToSession($, '/work', batch({ id: 'b9', agent: 'claude:s2' }), 's2')

  expect(world.sends).toHaveLength(1)
  expect(world.sends[0]?.to).toEqual({ sessionId: 's2' })
  expect(world.sends[0]?.text).toContain(`[review-batch b9]`)
  expect(states(world)[0]).toMatchObject({ id: 'b9', state: 'queued', reason: 'no running session by that id' })
})

test('a delivered send marks its batch delivered', async () => {
  const world: World = { files: {}, submitted: [], spawns: [], sends: [] }
  seed(world, [batch({ id: 'b7', agent: 'claude:s2' })], [entry({ agent: 'claude:s2' })])
  const $ = {
    clock: { now: async () => 1_000_000 },
    fs: {
      read: async (path: string) => {
        if (!(path in world.files)) throw new Error('ENOENT')
        return world.files[path] as string
      },
      write: async (path: string, text: string) => { world.files[path] = text },
      list: async (path: string) => Object.keys(world.files)
        .filter(file => file.startsWith(`${path}/`) && !file.slice(path.length + 1).includes('/'))
        .map(name => ({ name: name.slice(path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    },
    process: { run: mv(world) },
    session: { send: async () => ({ isDelivered: true as const }) },
  } as unknown as EngineInterface

  await deliverToSession($, '/work', batch({ id: 'b7', agent: 'claude:s2' }), 's2')

  expect(states(world)[0]).toMatchObject({ id: 'b7', state: 'delivered' })
  expect(world.files[`${threadDir('/work')}/queue.jsonl`]).toBeDefined()
})

test('a batch for another agent is not delivered here', async ($, on) => {
  const world = setup(on)
  seed(world, [batch({ agent: 'pi:p1' })], [entry({ agent: 'pi:p1' })])

  await $.turn.complete(STARTED)

  expect(world.submitted).toEqual([])
  expect(states(world).map(item => item.state)).toEqual(['queued'])
})

test('piModelFrom reads the model a pueue task was dispatched with', () => {
  expect(piModelFrom("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p \"$(cat '/tmp/a.md')\" < /dev/null")).toBe('openai/gpt:high')
  expect(piModelFrom('pi --model opencode-go/flash:off --session-id pueue-s1 -p x')).toBe('opencode-go/flash:off')
  expect(piModelFrom('pi --model=haiku --session-id pueue-s1 -p x')).toBe('haiku')
  expect(piModelFrom("pi --session-id 'pueue-s1' -p x")).toBeUndefined()
})

test('a Pi batch is dispatched with the original session id and model, and the text on disk first', async () => {
  const world = piWorld()
  const piBatch = batch({ agent: 'pi:pueue-s1' })
  seed(world, [piBatch], [entry({ agent: 'pi:pueue-s1' })])
  world.tasks = pueueTask("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p x < /dev/null", 'Queued')

  await deliverToPi(piEngine(world), '/work', piBatch, 'pueue-s1')

  const path = `${batchDir('/work')}/b1.md`
  expect(world.files[path]?.split('\n')[0]).toBe('[review-batch b1]')
  expect(world.files[path]).toContain('$HOME/dotfiles/scripts/review-reply --worktree /work --batch b1')
  expect(world.pueue).toEqual([[
    'pueue', 'add', '-i', '--print-task-id', '--label', 'review-b1', '-w', '/work', '--',
    "pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p \"$(cat '/work/.pi/agent-review/threads/batches/b1.md')\" < /dev/null",
  ]])
  expect(states(world)[0]).toMatchObject({ state: 'delivered', model: 'openai/gpt:high' })
  expect(states(world)[0]?.deliveredAt).toBeDefined()
})

test('the cycler model wins over the one the original run used', async () => {
  const world = piWorld()
  const piBatch = batch({ agent: 'pi:pueue-s1', model: 'haiku', effort: 'low' })
  seed(world, [piBatch], [entry({ agent: 'pi:pueue-s1' })])
  world.tasks = pueueTask("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p x", 'Queued')

  await deliverToPi(piEngine(world), '/work', piBatch, 'pueue-s1')

  expect(world.pueue[0]?.[9]).toContain("--model 'haiku'")
  expect(states(world)[0]).toMatchObject({ model: 'haiku', effort: 'low' })
})

test('no model keeps the batch queued with the reason, and no answerer is guessed', async () => {
  const world = piWorld()
  const piBatch = batch({ agent: 'pi:pueue-s1' })
  seed(world, [piBatch], [entry({ agent: 'pi:pueue-s1' })])
  world.tasks = pueueTask("pi --session-id 'pueue-s1' -p x", 'Queued')

  await deliverToPi(piEngine(world), '/work', piBatch, 'pueue-s1')

  expect(world.pueue).toEqual([])
  expect(world.files[`${batchDir('/work')}/b1.md`]).toBeUndefined()
  expect(states(world)[0]).toMatchObject({ state: 'queued', reason: 'no model' })
})

test('a running Pi task delays delivery: the note does not interrupt the turn', async () => {
  const world = piWorld()
  const piBatch = batch({ agent: 'pi:pueue-s1' })
  seed(world, [piBatch], [entry({ agent: 'pi:pueue-s1' })])
  world.tasks = pueueTask("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p x", 'Running')

  await deliverToPi(piEngine(world), '/work', piBatch, 'pueue-s1')

  expect(world.pueue).toEqual([])
  expect(states(world)[0]).toMatchObject({ state: 'queued' })
  expect(states(world)[0]?.reason).toBeUndefined()
})

test('a failed dispatch stays queued with the reason pueue gave', async () => {
  const world = piWorld()
  const piBatch = batch({ agent: 'pi:pueue-s1' })
  seed(world, [piBatch], [entry({ agent: 'pi:pueue-s1' })])
  world.tasks = pueueTask("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p x", 'Queued')
  world.addFails = true

  await deliverToPi(piEngine(world), '/work', piBatch, 'pueue-s1')

  expect(states(world)[0]).toMatchObject({ state: 'queued', reason: 'dispatch failed: Failed to connect to the daemon.' })
})

test('the 60-second tick retries a queued Pi batch and expires an old delivery', async ($, on) => {
  const world = setup(on)
  const stale = new Date(1_000_000 - 31 * 60_000).toISOString()
  world.files[queueFile('/work')] = `${JSON.stringify(batch({ agent: 'pi:pueue-s1' }))}\n${JSON.stringify(batch({ id: 'b2', agent: 'claude:s9', state: 'delivered', deliveredAt: stale }))}\n`
  world.files[threadFile('/work', 'pi:pueue-s1', 'src/a.ts')] = `${JSON.stringify(entry({ agent: 'pi:pueue-s1' }))}\n`
  world.tasks = pueueTask("pi --model 'openai/gpt:high' --session-id 'pueue-s1' -p x", 'Queued')

  await $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })
  await world.clock.advance(60_000)

  expect(world.pueue).toHaveLength(1)
  expect(states(world).map(item => [item.id, item.state])).toEqual([['b1', 'delivered'], ['b2', 'no-reply']])
})

test('a session in a subdirectory delivers the batches queued at the worktree root', async ($, on) => {
  const world = setup(on, { cwd: '/work/src' })
  seed(world, [batch()], [entry()])

  await $.turn.complete(STARTED)

  expect(world.submitted).toHaveLength(1)
  expect(states(world)[0]?.state).toBe('delivered')
})
