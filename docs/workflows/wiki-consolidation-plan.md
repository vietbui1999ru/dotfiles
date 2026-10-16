# Plan: reconcile llm-wiki checkouts and align with the spec loop

Status: approved by Opus planner and reviewer, 2026-10-16. Amended after review (see
"Review record"). Scope is limited to the two llm-wiki checkouts and the spec-loop docs. It
does not redo the AI workflow consolidation work order.

Executor: Haiku 5.5 general-purpose agent, run inside the wiki-consolidation worktree.
Commit trailer for every commit: `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.

## A. Fact check (2026-10-16)

1. Submodule B (`~/dotfiles/repos/llm-wiki`, detached at `ca9ac4d`) is an ancestor of A's
   `main` (`94e56a0`). `rev-list main..ca9ac4d` is empty; A is 37 commits ahead. Every commit
   reachable from B is reachable from A. One exception to "nothing unique" in B's refs:
   `b638955` ("ingest: Hello Interview + dev.to AI-agent interview prep guides") is on A's
   LOCAL branch `ingest-ai-interview-guides` only. It is not on `origin/main` and the remote
   branch is deleted. Do not delete that branch. The user decides later whether to merge or
   drop it.
2. Every `~/.claude/rules`, `~/.claude/skills` and related link into llm-wiki resolves to A.
   No llm-wiki link is dangling. Unrelated: `~/.claude/docs` points at a missing path. Out of
   scope; list it for the user.
3. README.md:92 already describes the two checkouts as independent. The stale text is in
   `docs/workflows/ai-workflow-consolidation.md`: trap 1 (lines 46-47) and the open Phase 6
   bullet (lines 205-206).
4. `~/.claude/skills/{grill-me,verify-spec}` and `~/.agents/skills/{grill-me,verify-spec}`
   point into `dotfiles/shared/skills`. A has `MOVED.md` stubs for both at `94e56a0`.
5. `~/.codex/hooks.json` links to `dotfiles/codex/.codex/hooks.json`. The uncommitted diff is a
   pure reorder of two SessionStart entries plus formatting. HOLD (see C).
6. SECURITY, resolved: A's `.codex/config.toml` held a plaintext Firecrawl key and a GitHub
   PAT. The user confirmed they live in a secrets store and had the two lines removed from the
   working file (2026-10-16). The committed version never contained them. The file stays
   uncommitted; never commit it. Rotation is advised because the keys were in plaintext on
   disk and may appear in agent transcripts. Firecrawl and GitHub MCP under Codex have no
   credentials from this file until the env-var move lands.
7. Unrelated stale file: `~/AGENTS.md` imports `~/.Codex/rules/*.md`, and those imported `.md`
   files do not exist. Not in scope; list it for the user.

## B. Survivor and reconciliation method

- A (`~/repos/llm-wiki`) stays the live authoring checkout. B stays a pinned submodule
  snapshot. No commits move. No relinking.
- Rejected: replacing A with a symlink to B. It needs a destructive delete of A.
- Pin bump via `update-index` in this worktree. B on disk is not touched.
- B reaches `94e56a0` only after the PR merges, through `submodule update` in `~/dotfiles`
  (user step T6).
- No rebase needed: the worktree is 3 commits behind dotfiles `origin/main`, touching files
  this PR does not touch.

## C. hooks.json decision

HOLD both files. Touch neither.
- `dotfiles/codex/.codex/hooks.json`: decide by starting Codex once and checking whether the
  file flips back. If it flips back, settle which tool owns the file before committing. If the
  Herdr form survives a few days, commit it as `chore(codex): accept Herdr rewrite of hooks.json`.
- A's `.codex/hooks.json`: untracked, the user's in-flight work. Hold.

## D. Tasks

All git commands use `/usr/bin/git` from the worktree root. rtk swallows exit codes, so judge
every check by its printed output.

T0. Commit the plan doc. Depends on: nothing.
- `/usr/bin/git add docs/workflows/wiki-consolidation-plan.md`
- Message: `docs(workflows): add llm-wiki consolidation plan`, then trailer.
- Verify: `/usr/bin/git status --porcelain` prints nothing.

T1. Preflight (read-only). Depends on: T0.
- `/usr/bin/git ls-tree HEAD repos/llm-wiki` shows `ca9ac4df6304553744e5d3d47722e7771b5b04dd`.
- `/usr/bin/git ls-remote git@github.com:vietbui1999ru/llm-wiki.git refs/heads/main` shows
  `94e56a09e0656ed8d97b9bb99b857dafe970f8a4`.
- If either differs, stop and report. Commit nothing further.

T2. Bump the submodule pin. Depends on: T1.
- `/usr/bin/git update-index --cacheinfo 160000,94e56a09e0656ed8d97b9bb99b857dafe970f8a4,repos/llm-wiki`
- Verify: `/usr/bin/git diff --cached --name-only` prints exactly `repos/llm-wiki`.
- Commit with `/usr/bin/git commit` (do not `git add`). Subject:
  `chore(submodule): bump llm-wiki to 94e56a0 (spec loop moved to dotfiles)`.
  Body: the pin was strictly behind `~/repos/llm-wiki` (ca9ac4d is an ancestor of 94e56a0),
  so no commits are lost; the new pin carries the MOVED.md stubs. Then trailer.
- Verify: `/usr/bin/git ls-tree HEAD repos/llm-wiki` shows `94e56a09...`.

T3. Doc edits. Depends on: T2.
First, Read `docs/workflows/ai-workflow-consolidation.md` lines 44-50 and 203-208, and copy
the old text EXACTLY, including line breaks and indentation. Do not retype it from this plan.
Edit 1 (trap 1, lines 46-47). Replace the sentence beginning "They are at the same commit
today but are NOT the same checkout" through "is false." with:
```
They are NOT the same checkout: the standalone clone is the live authoring checkout, and the
submodule is a pinned snapshot bumped after the wiki's `main` moves (resolved 2026-10-16; see
Phase 6).
```
Keep the rest of that trap bullet (`**Every rule, ...`) intact.
Edit 2 (Phase 6 bullet, lines 205-206). Replace the two-line bullet starting "- Reconcile the
two llm-wiki clones (trap 1)" with:
```
- Done 2026-10-16: reconciled the two llm-wiki clones (trap 1). The submodule was strictly
  behind the standalone clone (ca9ac4d is an ancestor of 94e56a0), so no commits were lost. The
  pin moved to 94e56a0 and the README describes both clones. No symlink swap: it would require
  deleting the standalone clone, which holds uncommitted local config.
```
Edit 3 (README.md line 92). Append to the end of that paragraph, after its last sentence:
` Commit and push wiki changes from the standalone clone first, then bump the pin here so the submodule matches its \`main\`.`
Verify (each token must be on one line; if a grep count is wrong, stop and report):
- `rg -c 'Done 2026-10-16|resolved 2026-10-16' docs/workflows/ai-workflow-consolidation.md` prints 2.
- `rg -c 'symlink to the latter is false' docs/workflows/ai-workflow-consolidation.md` prints nothing.
- `rg -c 'bump the pin here' README.md` prints 1.
Commit: `/usr/bin/git add docs/workflows/ai-workflow-consolidation.md README.md`, message
`docs: record llm-wiki clone roles and close the reconcile item`, then trailer.

T4. Push branch and open a draft PR. Depends on: T3.
- `/usr/bin/git push -u origin worktree-wiki-consolidation` (named branch only; never main)
- Write the PR body to a file first (`docs/workflows/` is NOT the place; use the job tmp dir
  `/Users/vietquocbui/.claude/jobs/a6233eae/tmp/pr-body.md`). Body contents: the T2 rationale;
  the note that both hooks.json files are held; the attribution line
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- `gh pr create --draft --base main --head worktree-wiki-consolidation --title "chore: reconcile llm-wiki checkouts (bump pin to 94e56a0)" --body-file /Users/vietquocbui/.claude/jobs/a6233eae/tmp/pr-body.md`
- Verify: `gh pr view --json state,isDraft` shows `OPEN` and `true`.

T5. Merge: CONFIRM-REQUIRED, user only. Depends on: T4.

T6. User step after merge, outside the worktree. Needs network. In `~/dotfiles`:
- `git pull --ff-only` (the uncommitted hooks.json is not touched by this PR).
- `git submodule update repos/llm-wiki` (fetches 94e56a0 over SSH; B is clean, so non-destructive).
- Verify: `~/dotfiles/.git/modules/repos/llm-wiki/HEAD` reads `94e56a09...`, and
  `ls ~/dotfiles/repos/llm-wiki/claude-setup/skills/grill-me` shows only `MOVED.md`.

CONFIRM-REQUIRED steps: only T5. No delete, reset, rebase, or force-push appears in this plan.

## E. Review record

- Opus planner: drafted plan and facts (2026-10-16).
- Opus reviewer: 16 findings. Applied: A.1 exception for `b638955` (finding 2); T0 committing
  the plan doc to clear the preflight (4); exact-string T3 instructions (6, 7); security
  status rewritten (9); `--body-file` and `--head` for T4 (11); executor and trailer named
  (15); network note on T6 (12); A.2 narrowed to llm-wiki links (5); ~/AGENTS.md wording (14).
  Confirmed without change: pin sha, B ancestry, pin-bump method, hooks.json hold, links.

## F. Non-goals

- Deleting, resetting, or replacing either checkout with a symlink.
- Deleting B's stale local `main` ref, or A's local branches (including `ingest-ai-interview-guides`).
- Committing, moving, or cleaning A's `.codex/config.toml` and `.codex/hooks.json`.
- Committing or discarding `dotfiles/codex/.codex/hooks.json` (held per C).
- Laya model-dispatch note (skipped: it would touch `wiki/entities/laya.md`, which the
  unmerged branch `docs/laya-skill-router-assessment` also changes). The decision not to wire
  Laya in stands.
- Fixing `~/AGENTS.md` or the dangling `~/.claude/docs` link. Separate decisions.
- Changing `bootstrap-dirs.sh`.
