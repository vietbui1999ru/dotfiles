import type { AgentSpawnArgs, EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseQueue, queueFile, type Batch } from './review-batch'
import { deliverToSession } from './review-deliver'
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

type World = { files: Record<string, string>; submitted: string[]; spawns: AgentSpawnArgs[]; sends: { to: unknown; text: string }[] }

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const failed = { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

// The engine's file system with a rename, as the queue writes it; the plugin's own hooks stay real.
const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = { files: {}, submitted: [], spawns: [], sends: [], ...over }
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
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
  on('process.run', ($, e) => {
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

const seed = (world: World, batches: readonly Batch[], entries: readonly ThreadEntry[]): void => {
  world.files[queueFile('/work')] = `${batches.map(item => JSON.stringify(item)).join('\n')}\n`
  for (const item of entries) {
    const path = threadFile('/work', item.agent, item.file)
    world.files[path] = `${world.files[path] ?? ''}${JSON.stringify(item)}\n`
  }
}

const states = (world: World) => parseQueue(world.files[queueFile('/work')] ?? '')

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
