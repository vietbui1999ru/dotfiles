import { expect, test } from 'claude-code/testing'

import {
  buildDigest,
  DIGEST_CAP,
  extractSavedPath,
  HEADINGS,
  isRealWork,
  MIN_PROMPTS_FOR_REAL_WORK,
  parseReply,
  taskStateFile,
  type DigestMessage,
} from './summary'

const msg = (over: Partial<DigestMessage> = {}): DigestMessage => ({
  role: 'user',
  text: '',
  toolUses: [],
  ...over,
})

test('real work is one successful edit or four prompts', () => {
  expect(isRealWork({ edits: 0, prompts: 0 })).toBe(false)
  expect(isRealWork({ edits: 0, prompts: MIN_PROMPTS_FOR_REAL_WORK - 1 })).toBe(false)
  expect(isRealWork({ edits: 1, prompts: 0 })).toBe(true)
  expect(isRealWork({ edits: 0, prompts: MIN_PROMPTS_FOR_REAL_WORK })).toBe(true)
})

test('an empty transcript digests to bounded placeholders', () => {
  const digest = buildDigest([])

  expect(digest).toContain('First user prompt:')
  expect(digest).toContain('Files edited: (none)')
  expect(digest).toContain('Failing tool results: (none)')
  expect(digest).toContain('Recent messages (0):')
})

test('the digest lists edited files and failing tool results', () => {
  const messages: DigestMessage[] = [
    msg({ role: 'user', text: 'fix the bug' }),
    msg({
      role: 'assistant',
      text: 'done',
      toolUses: [
        { tool: 'Edit', input: { file_path: 'src/a.ts' } },
        { tool: 'Write', input: { file_path: 'src/b.ts' } },
        { tool: 'Read', input: { file_path: 'README.md' } },
        { tool: 'Edit', input: { file_path: 'src/a.ts' } },
      ],
    }),
    msg({ role: 'user', text: 'retry', toolResults: [{ isError: true, text: 'boom' }] }),
  ]

  const digest = buildDigest(messages)

  expect(digest).toContain('src/a.ts')
  expect(digest).toContain('src/b.ts')
  expect(digest, 'a read is not an edit').not.toContain('README.md')
  expect(digest).toContain('boom')
  expect(digest).toContain('fix the bug')
})

test('a huge transcript is capped at DIGEST_CAP characters', () => {
  const messages: DigestMessage[] = Array.from({ length: 60 }, () =>
    msg({
      role: 'user',
      text: 'x'.repeat(1000),
      toolResults: [{ isError: true, text: 'y'.repeat(600) }],
    }),
  )

  const digest = buildDigest(messages)

  expect(digest.length).toBeLessThanOrEqual(DIGEST_CAP)
})

test('parseReply reads the goal and the six headings in any order', () => {
  const text = [
    'GOAL: Ship the widget',
    '## In Progress',
    '- polish',
    '## Completed',
    '- design',
    '## Decisions Made',
    '- go',
    '## Next Session Should',
    '- test',
    '## Files Modified This Session',
    '- src/widget.ts',
    '## Blocked / Needs Input',
    '- none',
  ].join('\n')

  const parsed = parseReply(text)

  expect(parsed?.goal).toBe('Ship the widget')
  for (const heading of HEADINGS) {
    expect(parsed?.body).toContain(`## ${heading}`)
  }
})

test('parseReply rejects a reply missing the goal line or a heading', () => {
  const withoutGoal = HEADINGS.map(h => `## ${h}\n- x`).join('\n')
  expect(parseReply(withoutGoal)).toBeUndefined()

  const missingHeading = 'GOAL: x\n## Completed\n- a'
  expect(parseReply(missingHeading)).toBeUndefined()
})

test('taskStateFile wraps frontmatter around the body', () => {
  const file = taskStateFile('TASK-7', '## Completed\n- done')

  expect(file.startsWith('---\n')).toBe(true)
  expect(file).toContain('status: active')
  expect(file).toContain('agent_task: TASK-7')
  expect(file).toContain('\n---\n\n## Completed\n- done\n')
})

test('extractSavedPath picks the sessions path out of agent-session output', () => {
  expect(extractSavedPath('✓ Saved: .agents/sessions/20261007_cc_general_x.md')).toBe('.agents/sessions/20261007_cc_general_x.md')
  expect(extractSavedPath('/Users/me/repo/.agents/sessions/a.md')).toBe('.agents/sessions/a.md')
  expect(extractSavedPath('no path here')).toBeUndefined()
})
