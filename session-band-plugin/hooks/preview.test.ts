import { expect, test } from 'claude-code/testing'

import { preview } from './preview'

test('renders gathered target facts and dry-run output', () => {
  expect(preview({
    command: 'rm *.tmp',
    reason: 'rm deletes files',
    totalBytes: 2_560,
    targets: [
      { path: 'one.tmp', bytes: 512, tracked: true },
      { path: 'two.tmp', bytes: 2_048, tracked: false },
    ],
    unexpandedGlobs: ['**/*.tmp'],
    dryRun: { label: 'git clean -n', output: 'Would remove one.tmp\nWould remove two.tmp' },
  })).toBe([
    'Blast-radius check',
    'Command: rm *.tmp',
    'Why: rm deletes files',
    'Targets: 2, 3 KiB total',
    '  one.tmp (512 B), git-tracked',
    '  two.tmp (2 KiB), not git-tracked',
    'Glob not expanded: **/*.tmp',
    'Dry run (git clean -n):',
    '  Would remove one.tmp',
    '  Would remove two.tmp',
  ].join('\n'))
})

test('caps previews at about forty lines and reports the omitted count', () => {
  const text = preview({
    command: 'rm *.tmp',
    reason: 'rm deletes files',
    targets: Array.from({ length: 50 }, (_, index) => ({ path: `file-${index}.tmp` })),
  })
  const lines = text.split('\n')

  expect(lines).toHaveLength(40)
  expect(lines.at(-1)).toBe('… 15 preview lines omitted')
  expect(text).not.toContain('file-49.tmp')
})
