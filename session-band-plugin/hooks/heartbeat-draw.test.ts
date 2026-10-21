import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// The heartbeat tells statusline-command.sh to stay silent, so it must mean "the band is on
// screen", not "the mod is loaded": only a band draw writes it.
const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const ALIVE = '/tmp/session-band-s1.alive'
const BAND = { component: 'AbovePrompt' as const, surface: 'terminal' as const, requestId: 'session-band', props: { hasSurvey: false, isWorking: false, maxRows: 1, bodyColumns: 160, scroll: { offset: 0, bodyRows: 1 }, view: {} } }

const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp', XDG_STATE_HOME: '/state' })
  const files: Record<string, string> = {}
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('fs.read', (_$, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] as never } })
  on('fs.write', (_$, e) => { files[e.path] = e.text; return { value: undefined } })
  return { clock, files }
}

test('a loaded mod whose band is never drawn writes no heartbeat', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start(START)
  await clock.advance(30_000)
  expect(files[ALIVE]).toBeUndefined()
})

test('drawing the band writes the heartbeat with the current time', async ($, on) => {
  const { files } = world(on)
  await $.session.start(START)
  await $.ui.render(BAND)
  expect(files[ALIVE]).toBe('1000000\t/work\n')
})

test('a later draw refreshes the heartbeat', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start(START)
  await $.ui.render(BAND)
  await clock.advance(16_000)
  await $.ui.render(BAND)
  expect(files[ALIVE]).toBe('1000016\t/work\n')
})
