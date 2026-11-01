import { expect, test } from 'claude-code/testing'

import { queueGroups } from './handoff'
import type { Task } from './pueue'

const task = (id: number, label: string | undefined, state: Task['state'] = 'Queued'): Task => ({
  id,
  cwd: '/repo',
  command: 'true',
  state,
  ...(label ? { label } : {}),
})

test('groups q: tasks by session in queue order, ignoring every other task', () => {
  const groups = queueGroups([
    task(9, 'q:s1:pr-merge:pull', 'Running'),
    task(3, 'edit-a'),
    task(2, 'q:s2:spec-approved:plan'),
    task(7, 'q:s1:pr-merge:wait-pr-merged'),
    task(5, undefined),
    task(11, 'q:s2:spec-approved:dispatch', 'Paused'),
    // A q: label that is not session:template:step is not a queue row.
    task(12, 'q:s1'),
    task(13, 'q:s1:pr-merge'),
  ])

  expect(groups).toEqual([
    {
      session: 's2',
      rows: [
        { id: 2, template: 'spec-approved', step: 'plan', state: 'Queued' },
        { id: 11, template: 'spec-approved', step: 'dispatch', state: 'Paused' },
      ],
    },
    {
      session: 's1',
      rows: [
        { id: 7, template: 'pr-merge', step: 'wait-pr-merged', state: 'Queued' },
        { id: 9, template: 'pr-merge', step: 'pull', state: 'Running' },
      ],
    },
  ])
})

test('no q: labels means no queue blocks', () => {
  expect(queueGroups([])).toEqual([])
  expect(queueGroups([task(1, 'edit-b', 'Done'), task(2, undefined, 'Failed')])).toEqual([])
})

test('queue rows follow template step order', () => {
  // pr-merge's steps run wait-pr-merged, then pull, then post, whatever the task ids are.
  const groups = queueGroups(
    [
      task(5, 'q:s1:pr-merge:pull'),
      task(6, 'q:s1:pr-merge:post'),
      task(9, 'q:s1:pr-merge:wait-pr-merged'),
      // A step the template does not list sorts last, by task id.
      task(2, 'q:s1:pr-merge:unlisted'),
    ],
    { 'pr-merge': ['wait-pr-merged', 'pull', 'post'] },
  )
  expect(groups[0]?.rows.map(row => row.id)).toEqual([9, 5, 6, 2])
})
