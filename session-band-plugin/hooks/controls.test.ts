import { expect, test } from 'claude-code/testing'

import { controlArgv, eligible, holdArgvs, parsePiArgs, releaseArgv, resolveTargets } from './controls'
import type { Task } from './pueue'

const pi = (id: number, state: Task['state']): Task => ({
  id, cwd: '/work', state, command: `pi --model m:high --session-id pueue-s${id} -p x < /dev/null`,
})
const tracked = (task: Task) => ({ id: task.id, cwd: '/work', addedMs: 0, task })

test('parses /pi arguments', () => {
  expect(parsePiArgs('')).toEqual({ kind: 'open' })
  expect(parsePiArgs('  ')).toEqual({ kind: 'open' })
  expect(parsePiArgs('kill 44 #45')).toEqual({ kind: 'control', action: 'kill', target: [44, 45] })
  expect(parsePiArgs('kill')).toEqual({ kind: 'control', action: 'kill', target: 'selected' })
  expect(parsePiArgs('pause all')).toEqual({ kind: 'control', action: 'pause', target: 'all' })
  expect(parsePiArgs('resume 3')).toEqual({ kind: 'control', action: 'resume', target: [3] })
  expect(parsePiArgs('rm 41')).toEqual({ kind: 'control', action: 'rm', target: [41] })
  expect(parsePiArgs('hold 44')).toEqual({ kind: 'control', action: 'hold', target: [44] })
  expect(parsePiArgs('release')).toEqual({ kind: 'control', action: 'release', target: 'all' })
  expect(parsePiArgs('kill 4x')).toMatchObject({ kind: 'error' })
  expect(parsePiArgs('explode 4')).toMatchObject({ kind: 'error' })
})

test('each action applies only to the states it can change', () => {
  expect(['Running', 'Queued', 'Paused'].every(state => eligible('kill', state as Task['state']))).toBe(true)
  expect(eligible('kill', 'Done')).toBe(false)
  expect(eligible('pause', 'Running')).toBe(true)
  expect(eligible('pause', 'Paused')).toBe(false)
  expect(eligible('resume', 'Paused')).toBe(true)
  expect(eligible('resume', 'Running')).toBe(false)
  expect(eligible('rm', 'Failed')).toBe(true)
  expect(eligible('rm', 'Running')).toBe(false)
})

test('resolves targets and refuses non-Pi, unknown and ineligible ids', () => {
  const running = pi(44, 'Running')
  const done = pi(41, 'Done')
  const other: Task = { id: 3, cwd: '/work', state: 'Running', command: 'make build' }
  const pueue = [running, done, other]
  const result = resolveTargets('kill', [44, 41, 3, 99], [tracked(running), tracked(done)], pueue)
  expect(result.ids).toEqual([44])
  expect(result.refused.map(item => item.id)).toEqual([41, 3, 99])
  expect(resolveTargets('kill', 'all', [tracked(running), tracked(done)], pueue).ids).toEqual([44])
  expect(resolveTargets('kill', 'selected', [tracked(running)], pueue, 44).ids).toEqual([44])
  expect(resolveTargets('kill', 'selected', [], pueue).ids).toEqual([])
})

test('never builds a pueue command with no ids', () => {
  expect(controlArgv('kill', [44, 45])).toEqual(['pueue', 'kill', '44', '45'])
  expect(controlArgv('resume', [44])).toEqual(['pueue', 'start', '44'])
  expect(controlArgv('rm', [41])).toEqual(['pueue', 'remove', '41'])
  expect(() => controlArgv('kill', [])).toThrow()
  expect(holdArgvs('default', [44])).toEqual([['pueue', 'pause', '--group', 'default', '--wait'], ['pueue', 'kill', '44']])
  expect(() => holdArgvs('default', [])).toThrow()
  expect(releaseArgv('default')).toEqual(['pueue', 'start', '--group', 'default'])
})
