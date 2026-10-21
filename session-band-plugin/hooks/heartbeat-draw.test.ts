import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { text } from './fake-pueue'

// Two signals: .alive (timer, "this process is alive", read by the pueue lifecycle and the worktrees pane)
// and .drawn (band draw, "the band is on screen", read by statusline-command.sh).
const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const ALIVE = '/tmp/session-band-s1.alive'
const DRAWN = '/tmp/session-band-s1.drawn'
const BAND = { component: 'AbovePrompt' as const, surface: 'terminal' as const, requestId: 'session-band', props: { hasSurvey: false, isWorking: false, maxRows: 1, bodyColumns: 160, scroll: { offset: 0, bodyRows: 1 }, view: {} } }

const world = (on: On, failDrawn = false) => {
  const clock = mock.clock(on, { now: 1_000_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp', XDG_STATE_HOME: '/state' })
  const files: Record<string, string> = {}
  const writes: string[] = []
  on('session.id', () => ({ value: 's1' }))
  on('session.cwd', () => ({ value: '/work' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('fs.read', (_$, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] as never } })
  on('fs.write', (_$, e) => {
    if (failDrawn && e.path === DRAWN) throw new Error('EACCES')
    writes.push(e.path)
    files[e.path] = e.text
    return { value: undefined }
  })
  return { clock, files, writes }
}

test('a loaded mod whose band is never drawn keeps .alive fresh but writes no .drawn', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start(START)
  await clock.advance(30_000)
  expect(files[ALIVE]).toBe('1000030\t/work\n')
  expect(files[DRAWN]).toBeUndefined()
})

test('drawing the band writes .drawn with the current time', async ($, on) => {
  const { files } = world(on)
  await $.session.start(START)
  await $.ui.render(BAND)
  expect(files[DRAWN]).toBe('1000000\n')
})

test('a later draw refreshes .drawn', async ($, on) => {
  const { clock, files } = world(on)
  await $.session.start(START)
  await $.ui.render(BAND)
  await clock.advance(16_000)
  await $.ui.render(BAND)
  expect(files[DRAWN]).toBe('1000016\n')
})

test('draws within five seconds write .drawn once', async ($, on) => {
  const { clock, writes } = world(on)
  await $.session.start(START)
  await $.ui.render(BAND)
  await clock.advance(2_000)
  await $.ui.render(BAND)
  await $.ui.render(BAND)
  expect(writes.filter(path => path === DRAWN)).toHaveLength(1)
})

test('a failing .drawn write still draws the band', async ($, on) => {
  world(on, true)
  await $.session.start(START)
  expect(text(await $.ui.render(BAND))).toContain('work')
})
