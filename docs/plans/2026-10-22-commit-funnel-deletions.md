# Plan: commit-funnel commits deleted paths

You are working in the git worktree `/Users/vietquocbui/dotfiles/.claude/worktrees/funnel-deletions`
on branch `fix/funnel-deletions`. Stay in it. Do not create another worktree or branch. Do not push.

## Goal
`scripts/commit-funnel` is the only way an agent in a `.claude/worktrees/` checkout may commit
(a git `reference-transaction` hook refuses plain `git commit` there). It fails on some deleted
paths, so agents cannot commit a deletion. Make every kind of listed deletion commit, in git mode
and in jj mode, and refuse a listed path that never existed.

## What is already known (do not re-derive)
- `test_git_commits_deletion` (AC-6 in `docs/SPEC-commit-funnel.md`) passes: a tracked file
  removed with a plain `unlink`, then `git add -- a.txt`, records the deletion.
- Hypothesis A (git mode, `commit_git`): after `git rm a.txt`, the path is in neither the work
  tree nor the index, so `git add -- a.txt` fails with
  `fatal: pathspec 'a.txt' did not match any files` and the funnel exits 1.
- Hypothesis B (jj mode, `commit_jj`): `jj file track root:"a.txt"` on a path missing from disk
  errors (or warns) before `jj commit` runs. jj snapshots deletions of tracked files without
  `file track`.
- These are hypotheses. Step 1 confirms or refutes them. If a test fails for a different reason,
  write the real error into your final report and fix that root cause, not a symptom.

## Files you may touch
Only these three:
- `scripts/commit-funnel`
- `scripts/tests/test_commit_funnel.py` (add tests; do not edit or delete existing ones)
- `docs/SPEC-commit-funnel.md` (do not edit any existing `verify:` line)

No new command-line flags. Keep the style of the script: small helpers, `refusals(reason, steps)`
for refusals, `Failure` for git/jj errors.

## Step 1: red tests
In `scripts/tests/test_commit_funnel.py`, next to `test_git_commits_deletion`, add three tests that
use the existing helpers (`init_repo(files=...)`, `jj_colocated()`, `run_funnel`, `assert_refused`,
`head_count`, `self.git`, `self.jj`):

1. `test_git_commits_staged_deletion`: `init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})`,
   `self.git("rm", "-q", "a.txt")`, run the funnel on `a.txt`. Expect exit 0,
   `git show --name-status --format= HEAD` split equals `["D", "a.txt"]`, `head_count()` is `"2"`.
2. `test_refuses_unknown_path`: `init_repo()`, run the funnel on `nope.txt` (never created).
   Expect `assert_refused(r, "nope.txt")` (exit 2) and `head_count()` still `"1"`.
3. `test_jj_commits_deletion`: `init_repo(files={"a.txt": "a\n", "keep.txt": "k\n"})`,
   `jj_colocated()`, unlink `a.txt`, run the funnel on `a.txt`. Expect exit 0,
   `jj diff --name-only -r @-` equals `["a.txt"]`, and `keep.txt` still exists in the work tree.

Run: `cd scripts/tests && python3 -m unittest test_commit_funnel -v 2>&1 | tail -30`.
Record which fail and their exact error text. Commit the tests (see Committing).

## Step 2: git mode
In `commit_git`, before any staging (after `check_git_index`):
- For each listed path, if it exists on disk (`os.path.lexists`), it goes to `git add --`.
- If it is missing from disk:
  - in the index (`git ls-files --error-unmatch -- <p>` exits 0): stage the removal with
    `git rm --cached -q -- <p>`;
  - else in HEAD (`git cat-file -e HEAD:<p>` exits 0): the deletion is already staged, do nothing;
  - else: refuse, reason `path {p!r} is not in the work tree, the index or HEAD`, steps
    "Check the path for typos; list only files you changed or deleted." and the usual rerun line.
- Classify all paths first and refuse before running any `git add` or `git rm`, so a refusal
  leaves the index untouched.
- Skip `git add` when no path is on disk.

## Step 3: jj mode
In `commit_jj`:
- Pass only paths that exist on disk to `jj file track`. Skip the call when there are none.
- Keep every listed path in the `jj commit` filesets.
- Refuse a path that is neither on disk nor in the parent commit. Test with
  `jj file list -r @- <fileset>`: empty output means it is not there. Refuse before running
  `jj file track`.

Put the "never existed" check in one helper that both modes call, if that keeps it simpler.

## Step 4: spec
In `docs/SPEC-commit-funnel.md`:
- D4: say that listed paths missing from disk are staged with `git rm --cached` when still
  indexed, left alone when the removal is already staged, and refused when unknown.
- D5: say that `jj file track` gets only the on-disk paths and that unknown paths are refused.
- Add `AC-14`, `AC-15` and `AC-16` after AC-13, one per new test, in the same
  `- AC-n: ...` plus indented `verify: \`cd scripts/tests && python3 -m unittest test_commit_funnel -k <test>\`` format.

## Committing
Commit after step 1, after steps 2+3, and after step 4. Always through the funnel:
write the message to a file outside the repo (for example `$HOME/.cache/pi-msg.txt`), then
```
$HOME/dotfiles/scripts/commit-funnel --worktree /Users/vietquocbui/dotfiles/.claude/worktrees/funnel-deletions -F $HOME/.cache/pi-msg.txt <path>...
```
Conventional-commit subject of at most 72 characters (`test(funnel): ...`, `fix(funnel): ...`,
`docs(funnel): ...`). Plain `git commit` is refused in this worktree by design. Do not try to get
around it.

## Traps
- The shell wrapper `rtk` can report exit 0 for failing commands. Judge test runs by the `OK` or
  `FAILED` line in the unittest output, never by the exit code.
- Use `/usr/bin/git` and absolute paths (`$HOME`, not `~`) in shell commands.
- Do not set `COMMIT_FUNNEL` or `AGENT_REF_GUARD` yourself; a safety hook blocks it and it is the
  human's override.
- `jj` must be installed for the jj tests; they fail, not skip, without it.

## Done when
- `cd scripts/tests && python3 -m unittest test_commit_funnel test_agent_ref_guard 2>&1 | tail -3`
  ends with `OK`.
- Three commits on `fix/funnel-deletions`, touching only the three files above.
- Final report: which hypothesis held (with the red-step error text), what you changed, and the
  final test output.
