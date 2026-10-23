import type { EngineInterface, On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { parseQueue, queueFile, type Batch } from './review-batch'
import { parseThread, threadFile, type ThreadEntry } from './review-thread'

const TOOL = 'mcp__session-band__review_reply'

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
  state: 'delivered',
  queuedAt: '2026-10-23T10:00:00.000Z',
  deliveredAt: '2026-10-23T10:01:00.000Z',
  ...over,
})

type World = { files: Record<string, string>; writes: string[] }

const ok = { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
const failed = { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }

const setup = (on: On): World => {
  const world: World = { files: {}, writes: [] }
  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp' })
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 1 }, rateLimits: [] } }))
  on('fs.read', ($, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', ($, e) => {
    world.writes.push(e.path)
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
  on('process.run', ($, e) => {
    if (e.argv[0] === 'git' && e.argv.includes('--show-toplevel')) return { value: { ...ok, stdout: '/work\n' } } as never
    const [cmd, flag, from, to] = e.argv
    if (cmd === 'mv' && flag === '-f' && from && to && from in world.files) {
      world.files[to] = world.files[from] as string
      delete world.files[from]
      return { value: ok } as never
    }
    return { value: failed } as never
  })
  return world
}

const seed = (world: World, batches: readonly Batch[], entries: readonly ThreadEntry[]): void => {
  world.files[queueFile('/work')] = `${batches.map(item => JSON.stringify(item)).join('\n')}\n`
  for (const item of entries) {
    const path = threadFile('/work', item.agent, item.file)
    world.files[path] = `${world.files[path] ?? ''}${JSON.stringify(item)}\n`
  }
}

const reply = async ($: Parameters<Parameters<typeof test>[1]>[0], input: Record<string, unknown>) => {
  const result = await $.tool.call({ tool: TOOL, ...input } as never)
  return JSON.stringify(result)
}

const thread = (world: World, file = 'src/a.ts') => parseThread(world.files[threadFile('/work', 'claude:s1', file)] ?? '')
const states = (world: World) => parseQueue(world.files[queueFile('/work')] ?? '')

test('a reply is written with the batch, the verdicts, the answering model, and answers the batch', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry({ id: 'e1', kind: 'patch', patch: '--- a\n+++ b\n' })])

  const result = await reply($, {
    batch: 'b1',
    file: 'src/a.ts',
    verdicts: [{ entry: 'e1', verdict: 'agree' }],
    text: 'landed it',
  })

  expect(result).toContain('reply recorded for src/a.ts')
  const written = thread(world)
  expect(written).toHaveLength(2)
  expect(written[1]).toMatchObject({
    agent: 'claude:s1',
    file: 'src/a.ts',
    kind: 'reply',
    author: 'agent',
    text: 'landed it',
    batch: 'b1',
    verdict: 'agree',
    replyTo: 'e1',
    model: 'claude-sonnet-5-5',
  })
  expect(written[1]?.id).not.toBe('e1')
  expect(states(world)[0]).toMatchObject({ id: 'b1', state: 'answered' })
})

test('a clapback is written as a clapback with its reason and the alternative patch', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry({ id: 'e1', kind: 'patch', patch: '--- a\n+++ b\n' })])

  await reply($, {
    batch: 'b1',
    file: 'src/a.ts',
    verdicts: [{ entry: 'e1', verdict: 'clapback' }],
    text: 'that drops the guard the caller relies on',
    patch: '--- a\n+++ b\n@@ -1 +1 @@\n-1\n+2\n',
  })

  expect(thread(world)[1]).toMatchObject({ kind: 'clapback', verdict: 'clapback', batch: 'b1', patch: '--- a\n+++ b\n@@ -1 +1 @@\n-1\n+2\n' })
})

test('the turn step names the model and effort that answered', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry()])
  on('turn.step', async function* () {
    return { turnId: 't1', index: 0, answer: '', toolUses: [], stopReason: null } as never
  })
  const stream = $.turn.step({ turnId: 't1', index: 0, model: 'opus', effort: 'high', messageCount: 2 })
  for await (const _chunk of stream) {
    // drain the response so the step settles above the plugin
  }

  await reply($, { batch: 'b1', file: 'src/a.ts', text: 'ok' })

  expect(thread(world)[1]).toMatchObject({ model: 'opus', effort: 'high' })
})

test('an unknown batch is refused and writes nothing', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry()])
  const before = [...world.writes]

  const result = await reply($, { batch: 'nope', file: 'src/a.ts', text: 'ok' })

  expect(result).toContain('unknown or undelivered review batch nope')
  expect(result).toContain('isError')
  expect(world.writes).toEqual(before)
  expect(thread(world)).toHaveLength(1)
})

test('a batch that was never delivered is refused too, and writes nothing', async ($, on) => {
  const world = setup(on)
  seed(world, [batch({ state: 'queued', deliveredAt: undefined })], [entry()])
  const before = [...world.writes]

  const result = await reply($, { batch: 'b1', file: 'src/a.ts', text: 'ok' })

  expect(result).toContain('unknown or undelivered review batch b1')
  expect(world.writes).toEqual(before)
})

test('a delivered batch waits for its other files before it is answered', async ($, on) => {
  const world = setup(on)
  seed(world, [batch({ entryIds: ['e1', 'e2'] })], [entry({ id: 'e1' }), entry({ id: 'e2', file: 'src/b.ts' })])

  await reply($, { batch: 'b1', file: 'src/a.ts', text: 'ok' })
  expect(states(world)[0]?.state).toBe('delivered')

  await reply($, { batch: 'b1', file: 'src/b.ts', text: 'also ok' })
  expect(states(world)[0]?.state).toBe('answered')
  expect(states(world)[0]?.answeredAt).toBeDefined()
})

test('a duplicate reply for a file already answered in that batch is ignored', async ($, on) => {
  const world = setup(on)
  seed(world, [batch({ entryIds: ['e1', 'e2'] })], [entry({ id: 'e1' }), entry({ id: 'e2', file: 'src/b.ts' })])

  await reply($, { batch: 'b1', file: 'src/a.ts', text: 'first' })
  const result = await reply($, { batch: 'b1', file: 'src/a.ts', text: 'second' })

  expect(result).toContain('already answered')
  expect(thread(world).filter(item => item.batch === 'b1')).toHaveLength(1)
  expect(thread(world)[1]?.text).toBe('first')
  // The same batch delivered twice shows once: an answered batch ignores the redelivered reply.
  await reply($, { batch: 'b1', file: 'src/b.ts', text: 'ok' })
  const again = await reply($, { batch: 'b1', file: 'src/b.ts', text: 'redelivered' })
  expect(again).toContain('already answered')
  expect(thread(world, 'src/b.ts').filter(item => item.batch === 'b1')).toHaveLength(1)
})

test('the tool reads the worktree root, so a session in a subdirectory still finds its queue', async ($, on) => {
  const world = setup(on)
  seed(world, [batch()], [entry()])
  const $sub = { ...$, session: { ...$.session, cwd: async () => '/work/src' } } as unknown as EngineInterface

  await expect(reply($sub as never, { batch: 'b1', file: 'src/a.ts', text: 'ok' })).resolves.toContain('reply recorded')
  expect(thread(world)).toHaveLength(2)
})
