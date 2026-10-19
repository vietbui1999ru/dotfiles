import { expect, test } from 'claude-code/testing'

import { parseWorktrees } from './worktrees'
import { specBranch, specRows, parseSpecStatus, acRunArgv, approveTimeoutMs, editRemoteArgv, parseReviewList, reviewRows, REVIEW_LIST_ARGV, skipArgv } from './gates'

test('gates builds spec argv, baseline timeout and space-safe Neovim edit argv', () => {
  expect(acRunArgv('/h', 'status', '/r/SPEC.md')).toEqual(['/h/dotfiles/scripts/ac-run', 'status', '/r/SPEC.md'])
  expect(approveTimeoutMs(2)).toBe(345000)
  expect(editRemoteArgv('/s', '/a b/SPEC.md')).toEqual(['nvim', '--server', '/s', '--remote-send', '<C-\\><C-N>:edit /a\\ b/SPEC.md<CR>'])
  expect(editRemoteArgv('/s', '/a%#|"\\/SPEC.md')[4]).toBe('<C-\\><C-N>:edit /a\\%\\#\\|\\"\\\\/SPEC.md<CR>')
})

test('gates parses only review arrays, drops missing ids and keys orphan rows', () => {
  expect(parseReviewList('not json')).toBeUndefined()
  expect(parseReviewList('{"a":1}')).toBeUndefined()
  const entries = [
    { runId: 'run-1', owner: '/r', branch: 'main', name: 'one', startedAt: '', processing: false, error: false, landed: true, orphan: false },
    { runId: 'run-2', owner: null, branch: '', name: '', startedAt: '', processing: false, error: false, landed: false, orphan: true },
  ]
  const parsed = parseReviewList(JSON.stringify([...entries, {}, null]))
  expect(parsed).toEqual(entries)
  expect(reviewRows(parsed!)).toEqual(entries.map(entry => ({ kind: 'review', key: `review:${entry.runId}`, worktree: entry.owner, entry })))
  expect(REVIEW_LIST_ARGV('/h')).toEqual(['/h/dotfiles/scripts/agent-review', 'list', '--all', '--json'])
  expect(skipArgv('/h', 'run-2')).toEqual(['/h/dotfiles/scripts/agent-review', 'skip', 'run-2'])
})

const trees = parseWorktrees('worktree /r\nHEAD abcdef123\nbranch refs/heads/feat/x\n\nworktree /r/.claude/worktrees/w\nHEAD abcdef123\nbranch refs/heads/feat/x\n')
const files = [{ rel: 'SPEC.md', text: '---\nstatus: draft\nbranch: feat/x\n---\n' }, { rel: 'specs/a.md', text: '---\nbranch: feat/x\n---\n' }]

test('gates reads branch only from closed front matter', () => {
  expect(specBranch(files[0]!.text)).toBe('feat/x')
  expect(specBranch('branch: feat/x')).toBeUndefined()
  expect(specBranch('---\nbranch: feat/x')).toBeUndefined()
})

test('gates discovers matching root and nested specs, not main mismatches or detached trees', () => {
  expect(specRows(trees[0]!, files).map(row => row.rel)).toEqual(['SPEC.md', 'specs/a.md'])
  expect(specRows({ ...trees[0]!, branch: 'main' }, files)).toEqual([])
  expect(specRows({ ...trees[0]!, detached: true }, files)).toEqual([])
})

test('gates keys same-relative-path specs by their absolute worktree path', () => {
  expect(trees.flatMap(tree => specRows(tree, files.slice(0, 1))).map(row => row.key)).toEqual(['/r/SPEC.md', '/r/.claude/worktrees/w/SPEC.md'])
})

test('gates trusts ac-run status and shows the first stderr line for invalid specs', () => {
  expect(parseSpecStatus({ exitCode: 0, stdout: 'approved (record matches)', stderr: '' })).toEqual({ state: 'approved' })
  expect(parseSpecStatus({ exitCode: 3, stdout: 'draft (no record)', stderr: '' })).toEqual({ state: 'draft' })
  expect(parseSpecStatus({ exitCode: 3, stdout: 'stale (spec changed)', stderr: '' })).toEqual({ state: 'stale' })
  expect(parseSpecStatus({ exitCode: 2, stdout: '', stderr: '\nSPEC.md:3: branch: is a, current branch is b\nmore' })).toEqual({ state: 'invalid', error: 'SPEC.md:3: branch: is a, current branch is b' })
})
