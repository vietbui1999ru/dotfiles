import { expect, test } from 'claude-code/testing'

import { deriveOutcome, STUCK_MS, type CheckRecord, type Outcome, type OutcomeInputs } from './outcome'

const HEAD = { commit: 'aaaa1111', diffHash: 'diff-1' }

const record = (over: Partial<CheckRecord> = {}): CheckRecord => ({
  phase: 'done', commit: HEAD.commit, diffHash: HEAD.diffHash, specStatus: 'approved', passed: true, round: 0, steered: false, ...over,
})

const inputs = (over: Partial<OutcomeInputs> = {}): OutcomeInputs => ({ pueue: { state: 'Running' }, reviewPending: false, head: HEAD, ...over })

const seen = (outcome: Outcome, tone: 'green' | 'red' | 'yellow' | 'muted', extra: { round?: number; reviewWaiting?: boolean } = {}) =>
  ({ outcome, tone, reviewWaiting: false, ...extra })

test('queued', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Queued' } }))).toEqual(seen('queued', 'muted'))
  expect(deriveOutcome(inputs({ pueue: { state: 'Paused' } }))).toEqual(seen('queued', 'muted'))
})

test('killed', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Killed' } }))).toEqual(seen('killed', 'muted'))
})

test('failed on exit 2', () => {
  // A pending review never rescues a real crash; only the review-waiting codes do.
  expect(deriveOutcome(inputs({ pueue: { state: 'Failed', exit: 2 }, reviewPending: true }))).toEqual(seen('failed', 'red', { reviewWaiting: true }))
})

test('review-waiting exit 3 is not failed', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Failed', exit: 3 }, reviewPending: true }))).toEqual(seen('finished', 'muted', { reviewWaiting: true }))
})

test('legacy exit 1 with pending review is not failed', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Failed', exit: 1 }, reviewPending: true }))).toEqual(seen('finished', 'muted', { reviewWaiting: true }))
  // Without the pending record, exit 1 is a crash like any other.
  expect(deriveOutcome(inputs({ pueue: { state: 'Failed', exit: 1 }, reviewPending: false }))).toEqual(seen('failed', 'red'))
})

test('checking', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ phase: 'checking', passed: undefined }) })))
    .toEqual(seen('checking', 'yellow'))
})

test('checks passed', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record() }))).toEqual(seen('checks passed', 'green'))
})

test('fixing carries the round', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Running' }, check: record({ passed: false, steered: true, round: 2 }) })))
    .toEqual(seen('fixing', 'yellow', { round: 2 }))
})

test('checks failed when not steered', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ passed: false, steered: false, round: 2 }) })))
    .toEqual(seen('checks failed', 'red'))
})

test('no spec', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ specStatus: 'none', passed: undefined }) })))
    .toEqual(seen('finished, no spec', 'muted'))
})

test('manual checks only', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ specStatus: 'manual-only', passed: undefined }) })))
    .toEqual(seen('finished, manual checks only', 'muted'))
})

test('stuck after 10 minutes working', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Running' }, agentStatus: 'working', logAgeMs: STUCK_MS })))
    .toEqual(seen('stuck', 'red'))
})

test('idle Pi is not stuck', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Running' }, agentStatus: 'idle', logAgeMs: STUCK_MS * 2 })))
    .toEqual(seen('running', 'muted'))
})

test('running outside herdr uses log age alone', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Running' }, logAgeMs: STUCK_MS - 1 }))).toEqual(seen('running', 'muted'))
  expect(deriveOutcome(inputs({ pueue: { state: 'Running' }, logAgeMs: STUCK_MS }))).toEqual(seen('stuck', 'red'))
})

test('checks stale after a new commit', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ commit: 'older' }) }))).toEqual(seen('checks stale', 'yellow'))
})

test('checks stale after uncommitted change', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' }, check: record({ diffHash: 'diff-0' }) }))).toEqual(seen('checks stale', 'yellow'))
})

test('finished without a record', () => {
  expect(deriveOutcome(inputs({ pueue: { state: 'Done' } }))).toEqual(seen('finished', 'muted'))
})
