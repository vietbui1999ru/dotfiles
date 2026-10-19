import { expect, test } from 'claude-code/testing'

import { emptyProgress, fold } from './pisession'

const message = (content: unknown[], overrides: Record<string, unknown> = {}) => JSON.stringify({
  type: 'message',
  timestamp: '2026-10-13T15:45:30.000Z',
  message: { role: 'assistant', content, ...overrides },
})

const toolResult = (blocks: { type: string; text: string }[], isError?: boolean) => JSON.stringify({
  type: 'message',
  timestamp: '2026-10-13T15:45:30.000Z',
  message: { role: 'toolResult', content: blocks, ...(isError ? { isError: true } : {}) },
})

test('an assistant thinking summary folds as a thinking entry', () => {
  const progress = fold(emptyProgress(), `${message([{ type: 'thinking', thinking: '**Plan**\n\nRead the spec' }])}\n`)
  expect(progress.entries).toEqual([{ kind: 'thinking', text: '**Plan**\n\nRead the spec' }])
})

test('two consecutive empty thinking blocks collapse to one marker', () => {
  const empty = (second: number) => JSON.stringify({
    type: 'message',
    timestamp: `2026-10-13T15:45:${String(second).padStart(2, '0')}Z`,
    message: { role: 'assistant', content: [{ type: 'thinking', thinking: '' }] },
  })
  expect(fold(emptyProgress(), `${empty(30)}\n${empty(31)}\n`).entries).toEqual([{ kind: 'thinking', text: '' }])
})

test('a toolResult folds as an output entry with two line- and width-capped lines', () => {
  const progress = fold(emptyProgress(), `${toolResult([{ type: 'text', text: 'line1\r\nline2\r\nline3' }])}\n`)
  expect(progress.entries).toEqual([{ kind: 'output', text: 'line1\nline2' }])
  const wide = fold(emptyProgress(), `${toolResult([{ type: 'text', text: 'x'.repeat(500) }])}\n`)
  expect(wide.entries).toEqual([{ kind: 'output', text: `${'x'.repeat(159)}…` }])
})

test('an errored toolResult is one error entry, never an output entry', () => {
  const progress = fold(emptyProgress(), `${toolResult([{ type: 'text', text: 'boom' }], true)}\n`)
  expect(progress.entries).toEqual([{ kind: 'error', text: 'boom' }])
})

test('a multi-line bash command collapses and the transcript line caps at 200 characters', () => {
  const heredoc = fold(emptyProgress(), `${message([{ type: 'toolCall', name: 'bash', arguments: { command: "cat <<'EOF'\nabc\nEOF" } }])}\n`)
  expect(heredoc.entries).toEqual([{ kind: 'tool', text: "bash cat <<'EOF' abc EOF" }])
  expect(heredoc.lastActivity).toBe("bash cat <<'EOF' abc EOF")

  const wide = fold(emptyProgress(), `${message([{ type: 'toolCall', name: 'bash', arguments: { command: 'x'.repeat(300) } }])}\n`)
  expect(wide.entries[0]?.text).toBe(`bash ${'x'.repeat(300)}`.slice(0, 200))
  expect(wide.entries[0]?.text.length).toBe(200)
  expect(wide.lastActivity).toBe(`bash ${'x'.repeat(40)}`)
})
