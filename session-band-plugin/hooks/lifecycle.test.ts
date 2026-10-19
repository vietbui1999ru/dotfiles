import { expect, test } from 'claude-code/testing'

import { statusGroups, statusText } from './band-text'
import { daemonState, ensureArgvs, isNotRunning, queueBadge } from './lifecycle'

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
