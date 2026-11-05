import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const READY = '/Users/test/.local/state/ac-run/ready'
const OK = { exitCode: 0, stdout: '', stderr: '' }

// Each test uses its own marker hash, since the prompt remembers hashes it asked this session.
type Setup = {
  clock: ReturnType<typeof mock.clock>
  markers: Record<string, string>
  asked: string[]
  answer: 'Approve' | 'Deny' | 'dismiss'
  calls: { argv: string[]; cwd?: string; timeoutMs?: number }[]
  toasts: string[]
  specExists: boolean
  interactive: boolean
  onAnswer?: () => void
}

const marker = (hash: string, spec = `/r/${hash}/SPEC.md`) => JSON.stringify({ spec, rel: 'SPEC.md', branch: 'feat/x', hash, ts: '2026-11-05' })

const setup = (on: On, over: Partial<Setup> = {}): Setup => {
  const world: Setup = { clock: mock.clock(on, { now: 1_000_000 }), markers: {}, asked: [], answer: 'Approve', calls: [], toasts: [], specExists: true, interactive: true, ...over }
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp' })
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200_000, percent: 0 }, rateLimits: [] } }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('settings.read', () => ({ value: {} }))
  on('command.register', () => ({ value: undefined }))
  on('ui.toast', (_$, e) => { world.toasts.push(String((e as { text?: unknown }).text ?? '')); return { value: undefined } as never })
  on('fs.list', (_$, e) => {
    if (e.path !== READY) return { value: [] as never }
    return { value: Object.keys(world.markers).map(hash => ({ name: `${hash}.json`, kind: 'file', size: 1, mtimeMs: 0, isLink: false })) as never }
  })
  on('fs.read', (_$, e) => {
    const hash = e.path.replace(`${READY}/`, '').replace(/\.json$/, '')
    if (e.path.startsWith(READY) && hash in world.markers) return { value: world.markers[hash] as never }
    throw new Error('ENOENT')
  })
  on('fs.exists', (_$, e) => {
    if (e.path.startsWith(READY)) return { value: e.path.replace(`${READY}/`, '').replace(/\.json$/, '') in world.markers as never }
    return { value: world.specExists as never }
  })
  on('process.run', (_$, e) => {
    const argv = [...e.argv]
    if (argv[1] === 'show') return { value: { ...OK, stdout: 'AC-1\n    runs: true\n    runs: false\n' } } as never
    if (argv[1] === 'approve' || argv[1] === 'reject') {
      world.calls.push({ argv, cwd: e.init?.cwd, timeoutMs: e.init?.timeoutMs })
      return { value: { ...OK, stdout: `${argv[1]}d\n` } } as never
    }
    return { value: { exitCode: 1, stdout: '', stderr: '' } } as never
  })
  on('tool.call', (_$, e) => {
    if (e.tool !== 'AskUserQuestion') return { result: 'ok', text: 'ok' }
    const question = (e as { questions: { question: string }[] }).questions[0]?.question ?? ''
    world.asked.push(question)
    world.onAnswer?.()
    if (world.answer === 'dismiss') throw new Error('dismissed')
    return { result: { answers: { [question]: world.answer } } } as never
  })
  return world
}

test('an approved ready spec runs spec approve with the baseline timeout', async ($, on) => {
  const world = setup(on, { answer: 'Approve' })
  world.markers.h1 = marker('h1')
  await $.session.start(START)
  await world.clock.advance(10_000)
  expect(world.asked.length).toBe(1)
  expect(world.calls).toEqual([{ argv: ['/Users/test/dotfiles/scripts/spec', 'approve', '/r/h1/SPEC.md'], cwd: '/r/h1', timeoutMs: 345000 }])
})

test('a denied ready spec runs spec reject and no approve', async ($, on) => {
  const world = setup(on, { answer: 'Deny' })
  world.markers.h2 = marker('h2')
  await $.session.start(START)
  await world.clock.advance(10_000)
  expect(world.calls).toEqual([{ argv: ['/Users/test/dotfiles/scripts/spec', 'reject', '/r/h2/SPEC.md'], cwd: '/r/h2', timeoutMs: undefined }])
})

test('a dismissed prompt runs neither and does not ask the same hash again', async ($, on) => {
  const world = setup(on, { answer: 'dismiss' })
  world.markers.h3 = marker('h3')
  await $.session.start(START)
  await world.clock.advance(10_000)
  expect(world.asked.length).toBe(1)
  expect(world.calls).toEqual([])
  await world.clock.advance(10_000)
  expect(world.asked.length).toBe(1)
})

test('a non-interactive session never asks', async ($, on) => {
  const world = setup(on, { interactive: false })
  world.markers.h4 = marker('h4')
  await $.session.start({ ...START, isInteractive: false })
  await world.clock.advance(30_000)
  expect(world.asked).toEqual([])
  expect(world.calls).toEqual([])
})

test('a marker gone after the answer runs nothing and says already decided', async ($, on) => {
  const world = setup(on, { answer: 'Approve' })
  world.markers.h5 = marker('h5')
  // Another session removes the marker while this prompt is open.
  world.onAnswer = () => { delete world.markers.h5 }
  await $.session.start(START)
  await world.clock.advance(10_000)
  expect(world.calls).toEqual([])
  expect(world.toasts).toContain('SPEC.md: already decided in another session')
})

test('a bad marker is skipped without asking', async ($, on) => {
  const world = setup(on, { answer: 'Approve' })
  world.markers.h6 = 'not json'
  await $.session.start(START)
  await world.clock.advance(10_000)
  expect(world.asked).toEqual([])
  expect(world.calls).toEqual([])
})
