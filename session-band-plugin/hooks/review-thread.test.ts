import type { EngineInterface } from 'claude-code'
import { expect, test } from 'claude-code/testing'

import { appendEntry, parseThread, readThread, threadDir, threadFile, type ThreadEntry } from './review-thread'

const entry = (over: Partial<ThreadEntry> = {}): ThreadEntry => ({
  id: 'e1',
  at: '2026-10-23T10:00:00.000Z',
  agent: 'pi:abc',
  file: 'src/a.ts',
  kind: 'comment',
  author: 'person',
  text: 'why?',
  ...over,
})

// The data layer touches the engine's file system and renames with `mv`; a fake with the same
// contract keeps the thread tests on the module rather than on the plugin chain.
const memoryFs = (mvFails = false) => {
  const files: Record<string, string> = {}
  const $ = {
    fs: {
      read: async (path: string) => {
        if (!(path in files)) throw new Error('ENOENT')
        return files[path] as string
      },
      write: async (path: string, text: string) => { files[path] = text },
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
  return { $, files }
}

test('a thread file names its agent and file in one stable, reversible path', () => {
  const path = threadFile('/w', 'pi:abc', 'src/a b.ts')

  expect(path).toBe('/w/.pi/agent-review/threads/pi%3Aabc/src%2Fa%20b.ts.jsonl')
  expect(threadDir('/w')).toBe('/w/.pi/agent-review/threads')
  expect(decodeURIComponent(path.split('/threads/')[1]!.replace(/\.jsonl$/, ''))).toBe('pi:abc/src/a b.ts')
  expect(decodeURIComponent(threadFile('/w', 'claude:s1', 'src/naïve—ok.ts').split('/threads/')[1]!.replace(/\.jsonl$/, ''))).toBe('claude:s1/src/naïve—ok.ts')
})

test('parseThread keeps the entries before a truncated last line', () => {
  const good = [entry(), entry({ id: 'e2', kind: 'reply', author: 'agent', text: 'because' })]
  const text = `${good.map(item => JSON.stringify(item)).join('\n')}\n{"id":"e3","kind":"comm`

  expect(parseThread(text)).toEqual(good)
})

test('parseThread skips lines that parse but lack an id, a kind or a file', () => {
  const good = entry({ id: 'e4' })
  const text = ['{"kind":"comment","file":"a.ts"}', '{"id":"x","file":"a.ts"}', '{"id":"y","kind":"comment"}', 'not json', JSON.stringify(good)].join('\n')

  expect(parseThread(text)).toEqual([good])
})

test('appendEntry then readThread round-trips entries in order', async () => {
  const { $, files } = memoryFs()
  const first = entry({ id: 'e1' })
  const second = entry({ id: 'e2', kind: 'patch', patch: '--- a\n+++ b\n' })
  const third = entry({ id: 'e3', kind: 'clapback', author: 'agent', verdict: 'clapback', replyTo: 'e2' })

  await appendEntry($, '/w', first)
  await appendEntry($, '/w', second)
  await appendEntry($, '/w', third)

  expect(await readThread($, '/w', 'pi:abc', 'src/a.ts')).toEqual([first, second, third])
  expect(files[threadFile('/w', 'pi:abc', 'src/a.ts')]!.split('\n').filter(line => line !== '')).toHaveLength(3)
})

test('appendEntry starts a new line after a truncated one so the write is not lost', async () => {
  const { $, files } = memoryFs()
  files[threadFile('/w', 'pi:abc', 'src/a.ts')] = `${JSON.stringify(entry({ id: 'e1' }))}\n{"id":"tr`

  await appendEntry($, '/w', entry({ id: 'e2' }))

  expect((await readThread($, '/w', 'pi:abc', 'src/a.ts')).map(item => item.id)).toEqual(['e1', 'e2'])
})

test('appendEntry replaces the thread by renaming a temporary file, leaving none behind', async () => {
  const { $, files } = memoryFs()

  await appendEntry($, '/w', entry({ id: 'e1' }))

  expect(Object.keys(files)).toEqual([threadFile('/w', 'pi:abc', 'src/a.ts')])
})

test('a failed rename throws and leaves the existing thread intact', async () => {
  const { $, files } = memoryFs(true)
  const path = threadFile('/w', 'pi:abc', 'src/a.ts')
  files[path] = `${JSON.stringify(entry({ id: 'e1' }))}\n`

  await expect(appendEntry($, '/w', entry({ id: 'e2' }))).rejects.toThrow('review thread not saved')

  expect((await readThread($, '/w', 'pi:abc', 'src/a.ts')).map(item => item.id)).toEqual(['e1'])
})

test('readThread is empty for a thread that was never written', async () => {
  const { $ } = memoryFs()

  expect(await readThread($, '/w', 'claude:s1', 'src/none.ts')).toEqual([])
})
