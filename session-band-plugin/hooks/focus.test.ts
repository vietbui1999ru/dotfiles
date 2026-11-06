// Pure tests for the focus chip (AC-9). bun:test, not the engine harness, so this file runs
// without the Claude Code host. The status JSON is the contract `scripts/focus status --json` prints.
import { expect, test } from 'claude-code/testing'

import { FOCUS_ARGV, focusChip, focusSlots, focusText, parseFocus, type FocusState } from './focus'

const WORK = { key: 'acme-api:feat/x', stage: 'plan' }
const HOBBY = { key: 'dotfiles:feat/focus', stage: 'build' }

const state = (over: Partial<FocusState> = {}): FocusState => ({ work: WORK, hobby: HOBBY, frozen: [], parked: [], read_only: false, breaches: [], ...over })

test('the chip shows the hobby and work slot with their stage', () => {
  expect(focusText(state())).toBe('H dotfiles:feat/focus·build W acme-api:feat/x·plan')
})

test('an empty slot shows a dash, so both slots always appear', () => {
  expect(focusSlots(state({ hobby: null }))).toBe('H — W acme-api:feat/x·plan')
  expect(focusText(state({ work: null, hobby: null }))).toBe('H — W —')
})

test('the frozen count appears only when there are frozen items', () => {
  expect(focusText(state({ frozen: [WORK, HOBBY] }))).toBe('H dotfiles:feat/focus·build W acme-api:feat/x·plan ❄2')
  expect(focusText(state())).not.toContain('❄')
})

test('read-only appears when the session sits outside a focus item', () => {
  expect(focusText(state({ read_only: true }))).toBe('H dotfiles:feat/focus·build W acme-api:feat/x·plan read-only')
})

test('no board gives no chip; the slots never drop, the frozen count drops at rank 2', () => {
  expect(parseFocus('{"no_board": true}')).toBeUndefined()
  expect(parseFocus(undefined)).toBeUndefined()
  expect(parseFocus('not json')).toBeUndefined()
  expect(focusChip(undefined)).toEqual([])
  const slots = focusChip(state())
  expect(slots).toHaveLength(1)
  expect(slots[0]?.tone).toBe('teal')
  expect(slots[0]?.drop).toBeUndefined()
  const frozen = focusChip(state({ frozen: [WORK] }))
  expect(frozen[1]).toMatchObject({ text: '❄1', drop: 2 })
})

test('a breach turns the chip red, read-only yellow', () => {
  expect(focusChip(state({ breaches: ['breach: Work holds 2 items'] }))[0]?.tone).toBe('red')
  expect(focusChip(state({ read_only: true }))[0]?.tone).toBe('yellow')
})

test('parseFocus reads the status JSON the script prints', () => {
  const parsed = parseFocus(JSON.stringify({ work: WORK, hobby: null, frozen: [HOBBY], parked: ['keep'], read_only: true, breaches: [] }))
  expect(parsed).toEqual({ work: WORK, hobby: null, frozen: [HOBBY], parked: ['keep'], read_only: true, breaches: [] })
})

test('the status argv runs the stowed script with the session cwd', () => {
  expect(FOCUS_ARGV('/Users/me', '/Users/me/dotfiles')).toEqual(['/Users/me/dotfiles/scripts/focus', 'status', '--json', '--cwd', '/Users/me/dotfiles'])
})
