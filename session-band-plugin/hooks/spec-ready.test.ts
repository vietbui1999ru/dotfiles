import { expect, test } from 'claude-code/testing'

import { askText, dirOf, parseMarker, READY_DIR } from './spec-ready'

test('spec-ready reads the ready directory under the state home', () => {
  expect(READY_DIR('/h')).toBe('/h/.local/state/ac-run/ready')
})

test('spec-ready parses a marker and rejects bad or incomplete ones', () => {
  const marker = JSON.stringify({ spec: '/r/w/SPEC.md', rel: 'SPEC.md', branch: 'feat/w', hash: 'abc', ts: '2026-11-05' })
  expect(parseMarker(marker)).toEqual({ spec: '/r/w/SPEC.md', rel: 'SPEC.md', branch: 'feat/w', hash: 'abc' })
  expect(parseMarker('not json')).toBeUndefined()
  expect(parseMarker('null')).toBeUndefined()
  expect(parseMarker(JSON.stringify({ rel: 'SPEC.md', hash: 'abc' }))).toBeUndefined()
  expect(parseMarker(JSON.stringify({ spec: '/r/SPEC.md', hash: 7 }))).toBeUndefined()
})

test('spec-ready caps the summary at forty lines and asks to approve', () => {
  const short = askText({ rel: 'SPEC.md' }, 'AC-1\n    runs: true')
  expect(short).toBe('SPEC.md\nAC-1\n    runs: true\n\nApprove this spec?')

  const long = Array.from({ length: 45 }, (_, i) => `line ${i + 1}`).join('\n')
  const capped = askText({ rel: 'SPEC.md' }, long)
  expect(capped).toContain('line 40\n… 5 more lines\n\nApprove this spec?')
  expect(capped).not.toContain('line 41\n')
})

test('spec-ready returns the parent directory of a spec path', () => {
  expect(dirOf('/r/w/SPEC.md')).toBe('/r/w')
  expect(dirOf('/SPEC.md')).toBe('/')
  expect(dirOf('SPEC.md')).toBe('.')
})
