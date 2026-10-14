import { expect, test } from 'claude-code/testing'

import { activityLabel } from './handoff'
import { emptyProgress, fold } from './pisession'

// The shape a real `pi -p` run against an unavailable model writes: the request fails and Pi retries.
const failed = (second: number) => JSON.stringify({
  type: 'message',
  timestamp: `2026-10-13T15:45:${String(second).padStart(2, '0')}Z`,
  message: { role: 'assistant', content: [], stopReason: 'error', errorMessage: '400: Model is unavailable.' },
})

test('an assistant error shows as one transcript error and as the activity', () => {
  const progress = fold(emptyProgress(), `${[30, 35, 40, 45].map(failed).join('\n')}\n`)

  expect(progress.entries).toEqual([{ kind: 'error', text: '400: Model is unavailable.' }])
  expect(progress.error).toBe('400: Model is unavailable.')
  expect(activityLabel(progress)).toBe('error')
})
