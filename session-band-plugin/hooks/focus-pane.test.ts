// Pure tests for the /focus pane (AC-10). bun:test, not the engine harness, so this file runs
// without the Claude Code host. The pane draws what these functions return.
import { expect, test } from 'claude-code/testing'

import type { FocusState } from './focus'
import { ACTIONS, keyOf, pick, pipeline, rowId, rows, slotLine, step } from './focus-pane-logic'

const WORK = { key: 'acme-api:feat/x', stage: 'plan' }
const HOBBY = { key: 'dotfiles:feat/focus', stage: 'build' }
const state = (over: Partial<FocusState> = {}): FocusState => ({ work: WORK, hobby: HOBBY, frozen: [], parked: [], read_only: false, breaches: [], ...over })

test('the pipeline shows every stage and brackets the current one', () => {
  expect(pipeline('build')).toBe('spec › plan › [build] › review › merge')
  expect(pipeline('spec')).toBe('[spec] › plan › build › review › merge')
})

test('an unknown stage lights no step', () => {
  expect(pipeline('?')).toBe('spec › plan › build › review › merge')
})

test('each slot line names its key and pipeline, or a dash when empty', () => {
  expect(slotLine('H', HOBBY)).toBe('H  dotfiles:feat/focus  spec › plan › [build] › review › merge')
  expect(slotLine('W', null)).toBe('W  —')
})

test('rows list frozen first, then parked, in board order', () => {
  const all = rows(state({ frozen: [WORK], parked: ['free text the person wrote'] }))
  expect(all).toEqual([
    { kind: 'frozen', key: 'acme-api:feat/x', stage: 'plan' },
    { kind: 'parked', text: 'free text the person wrote' },
  ])
})

test('j and k step through the rows and wrap at both ends', () => {
  const all = rows(state({ frozen: [WORK, HOBBY] }))
  const first = rowId(all[0]!)
  expect(step(all, first, 1)).toBe(rowId(all[1]!))
  expect(step(all, rowId(all[1]!), 1)).toBe(first)
  expect(step(all, first, -1)).toBe(rowId(all[1]!))
  expect(step([], undefined, 1)).toBeUndefined()
})

test('pick falls back to the first row when nothing is selected', () => {
  const all = rows(state({ frozen: [WORK] }))
  expect(pick(all, undefined)).toEqual(all[0])
  expect(pick(all, 'p:gone')).toEqual(all[0])
  expect(pick([], undefined)).toBeUndefined()
})

test('a frozen row acts on its key; a parked row acts only when its text is a bare key', () => {
  expect(keyOf({ kind: 'frozen', key: 'acme-api:feat/x', stage: 'plan' })).toBe('acme-api:feat/x')
  expect(keyOf({ kind: 'parked', text: 'dotfiles:feat/old' })).toBe('dotfiles:feat/old')
  expect(keyOf({ kind: 'parked', text: 'just a note' })).toBeUndefined()
  expect(keyOf(undefined)).toBeUndefined()
})

test('the hotkeys run the expected argv; drop never passes --yes', () => {
  expect(ACTIONS.switch('/h', 'dotfiles:feat/focus')).toEqual(['/h/dotfiles/scripts/focus', 'switch', 'dotfiles:feat/focus'])
  expect(ACTIONS.park('/h', 'dotfiles:feat/focus')).toEqual(['/h/dotfiles/scripts/focus', 'park', 'dotfiles:feat/focus'])
  expect(ACTIONS.drop('/h', 'dotfiles:feat/focus')).toEqual(['/h/dotfiles/scripts/focus', 'drop', 'dotfiles:feat/focus'])
  expect(ACTIONS.drop('/h', 'dotfiles:feat/focus')).not.toContain('--yes')
  expect(ACTIONS.open('/Users/me/repos/Obsidian/Focus.md')[1]).toBe('obsidian://open?path=%2FUsers%2Fme%2Frepos%2FObsidian%2FFocus.md')
  expect(ACTIONS.status('/h', '/w')).toEqual(['/h/dotfiles/scripts/focus', 'status', '--json', '--cwd', '/w'])
})

