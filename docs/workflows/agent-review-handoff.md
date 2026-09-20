# Agent Review — handoff (2026-09-20)

Written for a Pi session picking up from a Claude session that fixed and verified the Neovim half
of agent-review. Work through the tasks in order; they are ordered by risk, not by size.

## Read this first: the gate is live in this repo

`agent-review` is stowed and enabled, `pi-diff-review` is disabled. Every Pi run in `~/dotfiles`
that changes a file produces a pending review, and **the next input is blocked until it is
resolved**. That includes your own runs while doing this work.

Two ways to proceed:

- **Review each run** with `:AgentReview` in Neovim, which also serves as further live verification.
- **Turn the gate off** for the duration: `python3 scripts/agent-review mode off`, and
  `python3 scripts/agent-review mode on` when finished. The CLI is not on `PATH`; call it by path.

Check state at any time with `python3 scripts/agent-review status`.

## Current state

Committed through `a7745f8`, 28 commits unpushed on `main`. Nothing is pushed; that is deliberate.

Both suites pass and should be run before and after every task below:

```sh
cd ~/dotfiles/pi/.pi/agent/extensions/agent-review && bun test      # 27 tests
cd ~/dotfiles && nvim --clean --headless -l scripts/agent-review-nvim-test.lua   # 42 checks
```

Note the harness exits non-zero on failure through `os.exit`, but this shell's rtk wrapper discards
exit codes at the top level. To check the status, wrap it: `sh -c '<cmd> >/dev/null 2>&1; echo $?'`.

Verified end to end: the full round trip, exactly one follow-up per decision, decision validation,
panel notes following the cursor, the scoped diffview, the scoped decision patch, gitsigns
attaching on a tracked file, and a real rejection recorded as `changed` against an `accepted`.

Not verified: the interrupted-review path (F2, deliberately deferred), and `pi -p` print mode
(v2 scope, may simply fail).

## Task 1 — commit the working tree

Two files are modified, and they mix two authors' work:

- `nvim/.config/nvim/lua/custom/agent_review.lua` — a stylua reformat of the whole file, plus
  `vlog`/`M.verbose`, `M.status`, `M.clear_notes`, `:AgentReviewStatus`, `:AgentReviewClearNotes`
  (all written by the user), plus `changed_since` and the reject guard in `M.reject` (written by
  Claude).
- `scripts/agent-review-nvim-test.lua` — the `AGENT_REVIEW_DEBUG` flag and timing, a `M.status`
  check (user), and three reject-guard checks (Claude).

The reformat touches every line, so the two authors' changes cannot be split by hunk without
re-running stylua on an intermediate state. Do not attempt to split them. Commit once, and say
plainly in the message what the commit contains:

```
style+feat(agent-review): reformat, add status/clear-notes, guard rejection

Runs the module through stylua, which touches every line. Alongside that:
M.status and :AgentReviewStatus, M.clear_notes and :AgentReviewClearNotes,
and an M.verbose/vlog debug channel.

M.reject now refuses a file whose content changed after the run ended,
because rejecting restores the whole file and would discard those edits —
usually the reviewer's own work, not the agent's. :AgentReviewReject! and
the `force` argument override it. The check compares object ids via
git hash-object rather than git diff, which ignores untracked files and
would call a new file unchanged.
```

Attribution lines: this repo's commits end with the Claude co-author trailer only when Claude wrote
the change. This one is mixed; include it.

## Task 2 — `.gitignore` does not cover the review's own state

`.pi/agent-review/` is untracked and unignored. Nine decision files and a pending directory are one
`git add -A` away from entering history. `.gitignore` already has `/.pi/diff-review/` at line 34;
add the sibling:

```
/.pi/agent-review/
```

This is re-review finding N8, still open. Also add `scripts/.pi/` or, better, make the existing
`/docs/.pi/status/` rule general — Pi writes `.pi/status/` relative to its cwd, so any directory Pi
is started from accumulates one.

While there: `scripts/.pi/` is stray output from a subdirectory test and can be deleted.
`review-demo.ts` and `review-demo-2.ts` are disposable fixtures; delete them once the remaining
verification is done.

## Task 3 — the spec has fallen behind the code

`docs/workflows/agent-review.md` documents `:AgentReviewReject` and `:AgentReviewDebug` but not:

- the reject guard and its `!` override (Task 1's change),
- `:AgentReviewStatus` and `:AgentReviewClearNotes`,
- `M.verbose` / `:AgentReviewVerbose`,
- the `<leader>aR` keymap, in the keymap list alongside `ar`/`an`/`aD`.

Update the Neovim component section. Keep the existing style: state what the command does and why
the obvious alternative is wrong, since that is what stopped these bugs recurring.

## Task 4 — remaining verification

**F2, the interrupted review.** A review is claimed by renaming `pending/<id>.json` to
`<id>.processing`. Simulate a crash and confirm the gate holds:

```sh
cd ~/dotfiles
ID=<a pending review's uuid>
mv .pi/agent-review/pending/$ID.json .pi/agent-review/pending/$ID.processing
```

Start Pi, type any prompt: input must be refused with a notice naming that id. Then
`/review skip <id>` in Pi: expect "Cleared interrupted review …", an empty pending directory, and no
`refs/agent-review/<id>/*`. Automated equivalents already pass in
`agent-review.mode.test.ts`; this confirms them against the real runtime.

**`pi -p` print mode.** With mode on, a changing run should leave a pending record and exit
non-zero. This is v2 scope and may simply fail — record what happens rather than fixing it.

## Guardrails

- **Do not edit** `pi/.pi/agent/extensions/agent-review/agent-review.integration.test.ts`. It is the
  planner's contract suite; if a test there looks wrong, stop and report it.
- **Every new check must be shown to fail.** Break the code it covers, confirm red, restore. Three
  defects this session survived a green suite because nobody had stated what the expectation was.
- **Do not push.** The 28 unpushed commits stay local until the user decides.
- Keep `agent-review` stowed and `pi-diff-review` disabled. If verification fails badly, swap them
  back and restow rather than leaving the repo with no review gate.
