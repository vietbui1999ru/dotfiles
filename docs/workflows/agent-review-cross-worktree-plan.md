# Plan: make agent-review visible from any worktree, branch, or the root

Status: soft plan, not a spec. Written 2026-10-19 for a dedicated session to grill into a SPEC.md before any code changes.

## Problem

A Pi run dispatched through pueue with `-w <worktree>` writes its pending review to `<worktree>/.pi/agent-review/pending/`. The person reviewing from `~/dotfiles` saw nothing. Observed case: run `design-brief` (`5783111c`) in `.claude/worktrees/design-brief` was invisible, and it blocked a follow-up Pi task in that worktree ("input refused ... is pending").

## How state is resolved today

Every component calls `git rev-parse --show-toplevel`, so state is per worktree:

| Component | File | Resolves dir by | Scans other worktrees? |
|---|---|---|---|
| Pi extension (writer + input gate + decision watcher) | `pi/.pi/agent/extensions/agent-review/index.ts` (`repoRoot` ~:154, gate ~:423, `processDecision` ~:379) | toplevel of `ctx.cwd` | No (correct: the gate is about its own tree) |
| Neovim `:AgentReview` | `nvim/.config/nvim/lua/custom/agent_review.lua` (`root()` ~:19, `pending()` ~:116, `locate()` ~:144) | toplevel of buffer or cwd | Partly: `locate()` scans `git worktree list`, but **only when the current root has no pending review** |
| Session-band chips and panes | `session-band-plugin/hooks/{register,history,pane}.tsx` (`reviewRoot()`) | toplevel of `task.cwd` | No |
| CLI `status` / `approve` / `mode` | `scripts/agent-review` (`repo_root()` ~:20) | toplevel of process cwd | No |

Review refs (`refs/agent-review/<id>/{base,end}`) live in the shared object store and are already visible everywhere.

## Root cause of the observed miss

`locate()` returns early: `if #pending(repo) > 0 then return repo end`. The main checkout held a valid but stale record (`bcd1a32b`, `pi-built-in-mcp`, ended 2026-10-16), so the worktree scan never ran and the newer worktree review was shadowed.

## Invariants (must not break)

1. A pending record, its `decisions/` file and the Pi watcher stay in the **same worktree**. Pi only watches `<its root>/.pi/agent-review/decisions`.
2. Reject and restore write files under `repo/<path>`, using `git show <base>:<path>`. Any reader that acts on a run must first switch to the run's owning worktree; otherwise it edits the wrong checkout. `locate()`'s `tcd` is load-bearing for this.
3. Approve compares the fresh snapshot tree with `record.endTree`, so it refuses on mismatch. Keep it that way: it is the forged/stale guard.
4. The Pi input gate stays per worktree. A pending review in worktree A must not block Pi in worktree B (parallel delegation depends on this).
5. Agents never approve. Only the human decides (`plan-handoff.md`).

## Proposed approach (recommended: aggregate at read time, act in the owner)

Keep storage per worktree and add one shared discovery helper that every reader uses:

- `list_all_pending(any_path)`: run `git worktree list --porcelain` from any path, then gather valid pending records from every worktree. Each entry carries `{worktree, branch, record}`, sorted by `startedAt`. Also report records whose worktree path no longer exists (orphans).
- Each reader shows **all** pending reviews with their worktree and branch, and acts by switching to (or passing `cwd=`) the owning worktree.

Per component:
1. **Neovim**: replace `locate()`'s early return with the full scan. If more than one review is pending, show a picker (worktree, branch, name, age) instead of silently picking. Keep `tcd` to the chosen worktree.
2. **CLI**: `agent-review status --all` lists across worktrees. `approve <id>` finds the owning worktree by id and runs there (`cwd=owner`), so it works from the root or any branch.
3. **Session-band**: chips and panes use the shared scan, show a count across worktrees, and launch nvim and approve with the owner as cwd.
4. **Pi extension**: no change to the gate. Optionally make the refusal message print the owning worktree path and the exact command to open the review there.
5. **delegate-pi skill**: when dispatching with `-w <worktree>`, print where the review will appear.

Alternative considered and rejected: one central store under `$(git rev-parse --git-common-dir)/agent-review/`. That would give one place to look, but it breaks invariant 1 (the watcher and decisions must move together) and invariant 4 (the gate becomes global unless every record is filtered by worktree), and it needs a migration. Revisit only if the read-time scan proves too slow.

## Edge cases to cover in tests

- A stale or orphaned record in the root shadows a newer worktree record (the observed bug).
- A worktree was removed while its review was pending: list it as an orphan, never act on it.
- Two worktrees both pending: the picker shows both; approving one leaves the other untouched.
- A reject launched from the root on a worktree run writes only inside that worktree.
- Approve from the root on a worktree run: snapshot and `endTree` comparison run in the owner.
- A detached-HEAD worktree (branch missing in the porcelain output).
- The `.processing` and error records that the gate counts as blocking also show up in the listing.
- A decision made from another worktree or the root is consumed at the next Pi `session_start` in the owner, and that can race the session's own prompt (see below).

## Known race: decision consumed at session_start vs a `pi -p` prompt

**Status: fixed in #123 (2026-10-19).** In print mode (`ctx.hasUI === false`), a follow-up found at `session_start` is now held and queued as a `followUp` at `agent_start`. Interactive sessions are unchanged. Test: `agent-review.startup.test.ts`. The analysis below is kept because cross-worktree approval makes this path common: it is the normal way a decision reaches its owner.

Observed 2026-10-19 (pueue task #67). The human finished `:AgentReviewDone` for run `5783111c` while no Pi session was running in that worktree, so the decision sat in `decisions/` until the next Pi start. The next pueue run (`pi -p "<plan>"`) started in that worktree. At `session_start` (`index.ts` ~:554-568) the extension found the decision, ran `processDecision`, and sent the review's follow-up message to the agent. That started a turn. The `-p` prompt then arrived while the agent was busy, and Pi rejected it:

```
Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.
Extension error (<boundary>): turn_end could not resolve the persisted assistant entry ID
```

The task exited 1 having done nothing. The decision was consumed (pending went to 0), so an identical re-run (#68) succeeded. The failure only happens when a decision is waiting at startup, and a cross-worktree reviewer makes that much more likely, because the person approving is not in a live Pi session for that tree.

Fix options for the implementing session:
1. **Recommended.** At `session_start`, process waiting decisions (consume the record, delete the refs) but do not send the follow-up as a new turn. Queue it with `streamingBehavior: 'followUp'` so it runs after the prompt, or drop it when the session was started non-interactively with `-p`.
2. Make the CLI/nvim decision path wake an idle owner: if no Pi session is live in the owner, process the decision immediately from the reviewer side (snapshot, `endTree` check, consume), leaving nothing for `session_start`.
3. Minimum: in `delegate-pi`, before `pueue add -w <tree>`, refuse to dispatch while `<tree>/.pi/agent-review/decisions/` holds unprocessed files, and say why.

Test: a temporary repo with a pending record and a decision file, then start `pi -p "echo"` in it, and assert the prompt runs and the decision is consumed exactly once.

## Verification to require

- Existing suites stay green: the Pi extension `node:test` files (`agent-review.*.test.ts`, 25 tests per `docs/workflows/agent-review.md`), `nvim --clean --headless -l scripts/agent-review-nvim-test.lua` (20 checks), and session-band `hooks/review-controls.test.ts`, `history*.test.ts`.
- New tests for each edge case above, using temporary repos with real `git worktree add`.
- A manual use-test: dispatch a pueue Pi run with `-w` into a worktree, then confirm it appears from the root nvim, the band chip and `agent-review status --all`, and that reject edits only the worktree.

## Resolved since this plan was written

- Run `5783111c` (design-brief) was reviewed from inside its worktree.
- The stale root record `bcd1a32b` (`pi-built-in-mcp`, 2026-10-16) was skipped on 2026-10-19 after checking that all its changes were already on main. Recipe for a stale review with no live Pi session, used here:
  1. `pi --no-tools --no-session -p "/review skip <id>"` in the owner. This writes the skip decision; the process exits before its watcher handles it.
  2. `pi --no-tools --no-session -p "Reply with exactly: ok"` in the owner. `session_start` consumes the decision and deletes the refs; the follow-up runs without tools, so it cannot edit files.
  The tool should not need two runs. Add a CLI `agent-review skip <id>` that writes the decision and consumes it directly (snapshot, delete refs, delete pending) when no Pi session is live in the owner, sharing code with the approve path.

## Additional scope from the 2026-10-19 sessions

- Stale-record visibility: list each pending review with its age, and flag records whose `end` changes are already contained in `origin/main` as "landed, safe to skip". That check is what made `bcd1a32b` safe to dismiss.
- The `locate()` early return is the first fix to make: it is the whole cause of the observed miss and is a few lines in one file.

## Ownership

This is review-gate code. Keep it in Claude, not Pi: Pi must not edit the gate that reviews Pi (`plan-handoff.md`). Suggested path: `grill-me` → SPEC.md → human approval → implement in Claude with the tests above.
