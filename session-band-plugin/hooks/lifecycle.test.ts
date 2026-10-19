import { expect, test } from 'claude-code/testing'

import { statusGroups, statusText } from './band-text'
import { addOwner, daemonState, editRefusal, ensureArgvs, freshIds, idleCheck, IDLE_MS, isNotRunning, killNote, ownersPath, parseEdit, parseOwners, queueBadge, readdArgv } from './lifecycle'

const AT = '2026-10-10T00:00:00Z'
const task = (id: number, status: object) => ({ id, path: '/w', command: 'pi --model a/b -p x', created_at: AT, status })
const pueueJson = (status: string, parallel: number, tasks: { id: number }[] = []) =>
  JSON.stringify({ tasks: Object.fromEntries(tasks.map(item => [String(item.id), item])), groups: { default: { status, parallel_tasks: parallel } } })
const BAND = { dir: '~/w', model: 'opus', usage: {}, git: null, style: null }

test('not running is one state', () => {
  const states = [daemonState(1, ''), daemonState(0, pueueJson('Paused', 1)), daemonState(0, pueueJson('Running', 0))]
  for (const daemon of states) {
    expect(isNotRunning(daemon)).toBe(true)
    expect(queueBadge(daemon, true)).toBe('not running')
  }
  const ready = daemonState(0, pueueJson('Running', 1))
  expect(isNotRunning(ready)).toBe(false)
  expect(queueBadge(ready, true)).toBeUndefined()
  expect(queueBadge(states[0]!, false)).toBeUndefined()
  expect(ensureArgvs(states[0]!)).toEqual([['pueued', '-d'], ['pueue', 'start', '--group', 'default']])
  expect(ensureArgvs(states[1]!)).toEqual([['pueue', 'start', '--group', 'default']])
  expect(ensureArgvs(states[2]!)).toEqual([['pueue', 'start', '--group', 'default']])
  expect(ensureArgvs(ready)).toEqual([])
  expect(statusText(statusGroups({ ...BAND, piQueue: 'not running' }))).toContain('π not running')
})

test('daemon state reads pueue 4 status JSON', () => {
  const up = daemonState(0, pueueJson('Running', 1, [task(3, { Queued: { enqueued_at: AT } })]))
  expect(up).toMatchObject({ kind: 'up', group: 'running', tasks: [{ id: 3, state: 'Queued' }] })
  expect(daemonState(0, 'not json')).toEqual({ kind: 'down' })
})

test('dead owner is pruned', () => {
  const alive = freshIds([{ name: 'session-band-a.alive', mtimeMs: 100_000 }, { name: 'session-band-b.alive', mtimeMs: 0 }, { name: 'notes.txt', mtimeMs: 100_000 }], 100_000)
  expect(alive).toEqual(['a'])
  const empty = daemonState(0, pueueJson('Running', 1))
  expect(idleCheck({ owners: ['a', 'b'] }, empty, alive, 100_000).state.owners).toEqual(['a'])
  // A crashed owner alone cannot hold the daemon up past the idle window.
  expect(idleCheck({ owners: ['b'], emptySinceMs: 0 }, empty, alive, IDLE_MS).shutdown).toBe(true)
})

test('idle window shuts the daemon down', () => {
  const empty = daemonState(0, pueueJson('Running', 1))
  const first = idleCheck({ owners: [] }, empty, [], 1_000)
  expect(first).toEqual({ state: { owners: [], emptySinceMs: 1_000 }, shutdown: false })
  expect(idleCheck(first.state, empty, [], 1_000 + IDLE_MS - 1).shutdown).toBe(false)
  expect(idleCheck({ owners: ['a'], emptySinceMs: 1_000 }, empty, ['a'], 1_000 + IDLE_MS).shutdown).toBe(false)
  expect(idleCheck(first.state, empty, [], 1_000 + IDLE_MS).shutdown).toBe(true)
  expect(idleCheck(first.state, daemonState(1, ''), [], 1_000 + IDLE_MS)).toEqual({ state: { owners: [] }, shutdown: false })
  expect(addOwner({ owners: ['a'], emptySinceMs: 5 }, 'b')).toEqual({ owners: ['a', 'b'] })
  expect(ownersPath(undefined, '/Users/t')).toBe('/Users/t/.local/state/session-band/pueue-owners.json')
  expect(ownersPath('/x/state/', '/Users/t')).toBe('/x/state/session-band/pueue-owners.json')
  expect(parseOwners('{"owners":["a",3],"emptySinceMs":5}')).toEqual({ owners: ['a'], emptySinceMs: 5 })
  expect(parseOwners('')).toEqual({ owners: [] })
})

const RUNNING = task(1, { Running: { enqueued_at: AT, start: AT } })
const QUEUED = task(2, { Queued: { enqueued_at: AT } })

test('running task keeps daemon up', () => {
  const busy = daemonState(0, pueueJson('Running', 1, [RUNNING]))
  expect(idleCheck({ owners: [], emptySinceMs: 0 }, busy, [], IDLE_MS * 4)).toEqual({ state: { owners: [] }, shutdown: false })
})

test('held queue counts as live', () => {
  const held = daemonState(0, pueueJson('Paused', 1, [QUEUED]))
  expect(queueBadge(held, false)).toBe('held 1')
  expect(idleCheck({ owners: [], emptySinceMs: 0 }, held, [], IDLE_MS * 4).shutdown).toBe(false)
  expect(statusText(statusGroups({ ...BAND, piQueue: 'held 1' }))).toContain('π held 1')
})

test('edit refused unless queued', () => {
  expect(editRefusal('Queued')).toBeUndefined()
  for (const state of ['Running', 'Paused', 'Done', 'Failed', 'Killed'] as const) expect(editRefusal(state)).toContain(state)
  expect(editRefusal(undefined)).toContain('gone from pueue')
})

test('edit re-adds the same command with a new model and label', () => {
  expect(parseEdit('  x/y:low  fix the band ')).toEqual({ model: 'x/y:low', label: 'fix the band' })
  expect(parseEdit('   ')).toBeUndefined()
  const command = `pi --model 'a/b:high' --session-id 'pueue-s' -p "$(cat '/tmp/p.md')" < /dev/null`
  const argv = readdArgv({ id: 2, cwd: '/w', state: 'Queued', command, group: 'default' }, 'x/y:low', 'fix')
  expect(argv.slice(0, 8)).toEqual(['pueue', 'add', '--print-task-id', '--label', 'fix', '--group', 'default', '--'])
  expect(argv[8]).toBe(`pi --model 'x/y:low' --session-id 'pueue-s' -p "$(cat '/tmp/p.md')" < /dev/null`)
  expect(killNote('/w', ' M a\n?? b\n')).toBe(' /w holds 2 uncommitted changes; nothing was reverted.')
})
