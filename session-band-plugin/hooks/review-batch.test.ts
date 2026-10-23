import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { batchEntries, batchFiles, buildBatchText, enqueue, expireDelivered, markBatch, queueFile, readQueue } from './review-batch'
import { threadDir, type ThreadEntry } from './review-thread'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MINUTE = 60_000

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

// The queue renames a temporary file over itself, as the threads do; a fake with the engine's
// file-system and `mv` contract keeps these tests on the module rather than on the plugin chain.
const memoryFs = (mvFails = false) => {
  const files: Record<string, string> = {}
  let nowMs = Date.parse('2026-10-23T10:00:00.000Z')
  const $ = {
    clock: { now: async () => nowMs },
    fs: {
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path] as string
      },
      write: async (path: string, text: string) => { files[path] = text },
      list: async (path: string) => Object.keys(files)
        .filter(file => file.startsWith(`${path}/`))
        .map(name => ({ name: name.slice(path.length + 1), kind: 'file', size: 1, mtimeMs: 0, isLink: false })),
    },
    process: {
      run: async (argv: string[]) => {
        const [cmd, flag, from, to] = argv
        if (cmd !== 'mv' || flag !== '-f' || !from || !to || mvFails || !(from in files)) return { exitCode: 1, stdout: '', stderr: 'mv failed' }
        files[to] = files[from] as string
        delete files[from]
        return { exitCode: 0, stdout: '', stderr: '' }
      },
    },
  } as unknown as EngineInterface
  return { $, files, setNow: (ms: number) => { nowMs = ms } }
}

test('the batch text opens with the marker line and nothing before it', () => {
  const text = buildBatchText('b1', [entry()], 'tool')

  expect(text.split('\n')[0]).toBe('[review-batch b1]')
})

test('the batch text groups entries per file, keeps lines and fences patches with their entry id', () => {
  const comment = entry({ id: 'e1', file: 'src/a.ts', line: 12, text: 'why?' })
  const loose = entry({ id: 'e2', file: 'src/b.ts', text: 'naming here' })
  const patch = entry({ id: 'e3', file: 'src/a.ts', kind: 'patch', text: 'drop the guard', patch: '--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n' })

  const text = buildBatchText('b1', [comment, patch, loose], 'tool')

  expect(text).toContain('## src/a.ts')
  expect(text).toContain('- L12: why?')
  expect(text).toContain('## src/b.ts')
  expect(text).toContain('- naming here')
  expect(text).not.toContain('- L naming here')
  expect(text).toContain('```diff\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-const a = 1\n+const a = 2\n```')
  expect(text.indexOf('## src/a.ts')).toBeLessThan(text.indexOf('## src/b.ts'))
  // The patch fence names the entry it answers, so a reply can carry a verdict for it.
  expect(text.indexOf('e3')).toBeGreaterThan(text.indexOf('```diff') - 200)
  expect(text).toContain('e3')
})

test('the tool instructions tell the agent to call review_reply; the cli ones name scripts/review-reply', () => {
  const tool = buildBatchText('b1', [entry()], 'tool')
  const cli = buildBatchText('b1', [entry()], 'cli', '/w')

  expect(tool).toContain('review_reply')
  expect(tool).not.toContain('scripts/review-reply')
  expect(cli).toContain('$HOME/dotfiles/scripts/review-reply --worktree /w --batch b1')
  expect(cli).toContain('--verdict agree|clapback')
  expect(cli).toContain('clapback')
  expect(cli).not.toContain('Call `review_reply`')
})

test('the queue round-trips, the latest line for a batch id wins, and it appends rather than rewrites', async () => {
  const { $, files, setNow } = memoryFs()
  const first = await enqueue($, '/w', 'claude:s1', [entry({ id: 'e1' })])
  setNow(Date.parse('2026-10-23T10:01:00.000Z'))
  const second = await enqueue($, '/w', 'claude:s1', [entry({ id: 'e2' })])

  await markBatch($, '/w', first.id, 'delivered', { deliveredAt: '2026-10-23T10:02:00.000Z' })

  const queue = await readQueue($, '/w')
  expect(queue.map(batch => [batch.id, batch.state, batch.entryIds])).toEqual([
    [first.id, 'delivered', ['e1']],
    [second.id, 'queued', ['e2']],
  ])
  expect(queue[0]?.deliveredAt).toBe('2026-10-23T10:02:00.000Z')
  expect(queue[0]?.queuedAt).toBe('2026-10-23T10:00:00.000Z')
  expect(queue.map(batch => batch.id).every(id => UUID.test(id))).toBe(true)
  // Every write is one more line: two enqueues and one state change.
  expect(files[queueFile('/w')]!.split('\n').filter(line => line !== '')).toHaveLength(3)
  expect(queueFile('/w')).toBe(`${threadDir('/w')}/queue.jsonl`)
})

test('markBatch keeps the id and the agent, and a missing batch is not invented', async () => {
  const { $ } = memoryFs()
  const batch = await enqueue($, '/w', 'pi:p1', [entry({ id: 'e1' })])

  await markBatch($, '/w', batch.id, 'answered', { answeredAt: '2026-10-23T10:05:00.000Z', id: 'other', agent: 'claude:s9' })
  await markBatch($, '/w', 'unknown', 'answered')

  const queue = await readQueue($, '/w')
  expect(queue).toHaveLength(1)
  expect(queue[0]).toMatchObject({ id: batch.id, agent: 'pi:p1', state: 'answered', answeredAt: '2026-10-23T10:05:00.000Z' })
})

test('a batch delivered 29 minutes ago stays; one delivered 31 minutes ago is no reply', () => {
  const deliveredAt = '2026-10-23T10:00:00.000Z'
  const at = Date.parse(deliveredAt)
  const delivered = { id: 'b1', agent: 'claude:s1', entryIds: ['e1'], state: 'delivered' as const, queuedAt: deliveredAt, deliveredAt }
  const stillQueued = { id: 'b2', agent: 'claude:s1', entryIds: ['e2'], state: 'queued' as const, queuedAt: deliveredAt }

  expect(expireDelivered([delivered, stillQueued], at + 29 * MINUTE)).toEqual([])
  expect(expireDelivered([delivered, stillQueued], at + 30 * MINUTE)).toEqual([])
  expect(expireDelivered([delivered, stillQueued], at + 31 * MINUTE)).toEqual([{ ...delivered, state: 'no-reply' }])
})

test('batch entries and files follow the batch order, whatever order the threads hold', async () => {
  const { $, files } = memoryFs()
  const batch = await enqueue($, '/w', 'claude:s1', [entry({ id: 'e2', file: 'src/b.ts' }), entry({ id: 'e1', file: 'src/a.ts' })])
  files[`${threadDir('/w')}/claude%3As1/src%2Fa.ts.jsonl`] = `${JSON.stringify(entry({ id: 'e1', file: 'src/a.ts' }))}\n`
  files[`${threadDir('/w')}/claude%3As1/src%2Fb.ts.jsonl`] = `${JSON.stringify(entry({ id: 'e2', file: 'src/b.ts' }))}\n${JSON.stringify(entry({ id: 'e9', file: 'src/b.ts' }))}\n`

  expect((await batchEntries($, '/w', batch)).map(item => item.id)).toEqual(['e2', 'e1'])
  expect(await batchFiles($, '/w', batch)).toEqual(['src/b.ts', 'src/a.ts'])
})
