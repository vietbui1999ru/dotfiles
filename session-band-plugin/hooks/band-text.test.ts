import { expect, test } from 'claude-code/testing'

import { fitStatus, layoutBand, statusGroups, statusText, type StatusInput } from './band-text'

const full: StatusInput = {
  dir: 'llm-wiki',
  model: 'opus-5-5',
  usage: { ctx: 30, five: 12, seven: 34 },
  git: { branch: 'feat/x', isDirty: true, ahead: 2, behind: 1, hasUpstream: false, stash: 1 },
  style: 'explanatory',
  openAlerts: 2,
}

test('status line: four groups, one separator between groups, one space inside a group', () => {
  expect(statusText(statusGroups(full))).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5 explanatory')
})

test('ahead and behind use the same arrows as the worktrees pane', () => {
  const where = statusGroups(full)[0]?.map(seg => seg.text)
  expect(where).toEqual(['llm-wiki', 'feat/x*', 'local', '↑2', '↓1', '≡1'])
})

test('no git, no usage, no alerts: dir and model only', () => {
  expect(statusText(statusGroups({ dir: '~', model: 'opus', usage: {}, git: null, style: null }))).toBe('~ · opus')
})

test('a narrow band drops style, then local, then stash', () => {
  const groups = statusGroups(full)
  expect(statusText(fitStatus(groups, 200))).toBe(statusText(groups))
  expect(statusText(fitStatus(groups, 85))).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5')
  expect(statusText(fitStatus(groups, 75))).toBe('llm-wiki feat/x* ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5')
  expect(statusText(fitStatus(groups, 70))).toBe('llm-wiki feat/x* ↑2 ↓1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5')
})

test('the Pi hand-off chip is one icon and reserves two cells', () => {
  const handoff = { kind: 'single' as const, text: '', id: 12, glyph: '!', state: 'Failed' as const, model: 'openai/gpt', effort: 'high', elapsed: '3m', tokens: '12k', cost: '$0.10', files: 2, label: 'fix', review: 'changes requested' as const, exit: 1 }
  const fits = layoutBand({ ...full, handoff, width: 98, wt: true, history: true })
  expect(fits.wt).toBe('⎇')
  expect(fits.history).toBe('⟲')
  expect(fits.pi).toBe('π')
  expect(statusText(fits.status)).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5 explanatory')
  const tight = layoutBand({ ...full, handoff, width: 97, wt: true, history: true })
  expect(tight.pi).toBe('π')
  expect(statusText(tight.status)).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5')
  expect(layoutBand({ ...full, width: 98, wt: true, history: true }).pi).toBeUndefined()
})

test('each icon chip reserves two cells: the status line drops style once both chips show', () => {
  const one = layoutBand({ ...full, width: 95, wt: true, history: false })
  expect(statusText(one.status)).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5 explanatory')
  expect(one.history).toBeUndefined()
  const both = layoutBand({ ...full, width: 95, wt: true, history: true })
  expect(statusText(both.status)).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 · opus-5-5')
})

test('send-it run: red, after the alerts; no run when sendIt is false', () => {
  expect(statusText(statusGroups({ ...full, sendIt: true }))).toBe('llm-wiki feat/x* local ↑2 ↓1 ≡1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 ⇉ send-it · opus-5-5 explanatory')
  expect(statusText(statusGroups({ ...full, sendIt: false }))).toBe(statusText(statusGroups(full)))
  expect(statusGroups({ ...full, openAlerts: undefined, sendIt: true })[2]?.[0]).toEqual({ text: '⇉ send-it', tone: 'red' })
})

test('the send-it run survives fitStatus at narrow widths; style, local and stash go first', () => {
  expect(statusText(fitStatus(statusGroups({ ...full, sendIt: true }), 60))).toBe('llm-wiki feat/x* ↑2 ↓1 · ━━━╸──────── 30% 5h:12% 7d:34% · ⚠2 ⇉ send-it · opus-5-5')
  expect(statusText(fitStatus(statusGroups({ ...full, openAlerts: undefined, sendIt: true }), 20))).toContain('⇉ send-it')
})
