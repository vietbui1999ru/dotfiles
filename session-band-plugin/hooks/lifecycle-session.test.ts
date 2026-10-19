import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { dispatch, fakePueue } from './fake-pueue'

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
