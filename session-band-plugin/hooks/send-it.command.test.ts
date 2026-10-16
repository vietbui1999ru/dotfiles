import type { On } from 'claude-code'
import { expect, mock, test, type Engine } from 'claude-code/testing'

import { SEND_IT_BLOCK } from './send-it'

const HOME = '/Users/test'
const REPO = '/work/repo'
const SETTINGS = `${REPO}/.claude/settings.local.json`
const LOG = `${HOME}/.claude/state/send-it.log`
const ok = (stdout: string) => ({ exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false })

type World = { files: Record<string, string>; common: string; rootDate: string }

const setup = (on: On, over: Partial<World> = {}): World => {
  const world: World = { files: { [SETTINGS]: '{\n  "model": "sonnet"\n}\n' }, common: `${REPO}/.git`, rootDate: '2026-11-01T00:00:00+00:00', ...over }

  mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME })
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    if (argv.includes('--git-common-dir')) return { value: ok(`${REPO}\n${world.common}`) }
    if (argv.startsWith('git rev-list')) return { value: ok('deadbeef\n') }
    if (argv.startsWith('git show')) return { value: ok(world.rootDate) }
    return { value: { exitCode: 1, stdout: '', stderr: 'boom', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('fs.exists', ($, e) => ({ value: e.path in world.files as never }))
  on('fs.read', ($, e) => {
    if (!(e.path in world.files)) throw new Error('ENOENT')
    return { value: world.files[e.path] as never }
  })
  on('fs.write', ($, e) => {
    world.files[e.path] = e.text
    return { value: undefined }
  })
  return world
}

const send = (args: string, origin: 'composer' | 'plugin' = 'composer') => ({
  command: 'send-it',
  args,
  origin: origin === 'composer' ? { kind: 'composer' as const } : { kind: 'plugin' as const, name: 'other' },
  presentation: { isFullscreen: false, columns: 120 },
})

test('a plugin origin is refused and nothing is written', async ($: Engine, on) => {
  const world = setup(on)
  const before = world.files[SETTINGS]

  const result = await $.command.run(send('on', 'plugin'))

  expect(result.text).toContain('refused')
  expect(world.files[SETTINGS]).toBe(before)
})

test('a composer origin on a refused repo is refused and nothing is written', async ($, on) => {
  const world = setup(on, { common: `${HOME}/dotfiles/.git` })
  const before = world.files[SETTINGS]

  const result = await $.command.run(send('on'))

  expect(result.text).toContain('refused list')
  expect(world.files[SETTINGS]).toBe(before)
})

test('a composer origin on an eligible repo writes the block, and off restores the text', async ($, on) => {
  const world = setup(on, { files: { [SETTINGS]: '{}\n' } })
  const original = world.files[SETTINGS]

  const on1 = await $.command.run(send('on'))
  expect(on1.text).toBe('written; restart to apply')
  const written = JSON.parse(world.files[SETTINGS]!)
  expect(written.env.SEND_IT).toBe('1')
  expect(written.model).toBe('opus')
  expect(written.permissions.defaultMode).toBe('dontAsk')
  expect(written.sandbox.enabled).toBe(true)
  expect(written.send_it_block).toBeUndefined()

  const off1 = await $.command.run(send('off'))
  expect(off1.text).toBe('written; restart to apply')
  expect(world.files[SETTINGS]).toBe(original)
})

test('a malformed settings file is reported and not overwritten', async ($, on) => {
  const world = setup(on)
  world.files[SETTINGS] = '{"env": {"TOKEN": "x" '

  const result = await $.command.run(send('on'))

  expect(result.text).toContain('not editing it')
  expect(result.text).not.toContain('TOKEN')
  expect(world.files[SETTINGS]).toBe('{"env": {"TOKEN": "x" ')
})

test('a conflicting key is named in the reply without its value, and nothing is written', async ($, on) => {
  const world = setup(on)
  const before = world.files[SETTINGS]

  const result = await $.command.run(send('on'))

  expect(result.text).toContain('already hold other values')
  expect(result.text).toContain('model')
  expect(result.text).not.toContain('sonnet')
  expect(world.files[SETTINGS]).toBe(before)
})

test('status reports on and off as the file holds them', async ($, on) => {
  setup(on, { files: { [SETTINGS]: '{}' } })

  expect((await $.command.run(send('status'))).text).toBe('send-it is off for this repo')
  await $.command.run(send('on'))
  expect((await $.command.run(send('status'))).text).toBe('send-it is on for this repo')
})
