import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue, text } from './fake-pueue'

const START = { cwd: '/work', surface: 'terminal' as const, isInteractive: true }
const OWNERS = '/state/session-band/pueue-owners.json'

const world = (on: On) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.env(on, { HOME: '/Users/test', TMPDIR: '/tmp', XDG_STATE_HOME: '/state' })
  const files: Record<string, string> = {}
  on('session.id', () => ({ value: 's1' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('session.end', (_$, e) => ({ sessionId: e.sessionId }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // register.tsx's session.start registers commands before it reaches the lifecycle check.
  on('command.register', () => ({ value: undefined }))
  on('settings.read', () => ({ value: {} }))
  on('fs.read', (_$, e) => { if (!(e.path in files)) throw new Error('ENOENT'); return { value: files[e.path] as never } })
  on('fs.write', (_$, e) => { files[e.path] = e.text; return { value: undefined } })
  on('fs.list', () => ({ value: [{ name: 'session-band-s1.alive', kind: 'file', size: 12, mtimeMs: clock.now(), isLink: false }] as never }))
  const pueue = fakePueue(on, clock.now)
  return { clock, files, pueue }
}

test('session end removes its owner', async ($, on) => {
  const { files } = world(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  expect(JSON.parse(files[OWNERS]!).owners).toEqual(['s1'])
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's1', resume: { id: 's1' } })
  expect(JSON.parse(files[OWNERS]!).owners).toEqual([])
})

test('the idle check shuts an empty daemon down after 15 minutes with no owner', async ($, on) => {
  const { clock, pueue } = world(on)
  await $.session.start(START)
  await clock.advance(14 * 60_000)
  expect(pueue.order).not.toContain('pueue shutdown')
  await clock.advance(2 * 60_000)
  expect(pueue.order).toContain('pueue shutdown')
  expect(pueue.down).toBe(true)
})

const BAND = { component: 'AbovePrompt' as const, surface: 'terminal' as const, requestId: 'session-band', props: { hasSurvey: false, isWorking: false, maxRows: 1, bodyColumns: 160, scroll: { offset: 0, bodyRows: 1 }, view: {} } }

test('the band shows one not running state while dispatched work waits', async ($, on) => {
  const { clock, pueue } = world(on)
  await $.tool.call({ tool: 'Bash', command: `pueue add -- ${dispatch}` })
  pueue.down = true
  await clock.advance(2_000)
  expect(text(await $.ui.render(BAND))).toContain('π not running')
})
