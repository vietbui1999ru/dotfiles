---
status: approved
branch: feat/agent-review-cross-worktree
---
# SPEC: agent-review visible and actionable from any worktree (Phase 1)

## Objective
A pending agent review in any worktree of a repo can be found, opened, approved and skipped from any other worktree, branch, or the root checkout. Success: with a review pending only in `.claude/worktrees/x`, `agent-review list --all` from the root shows it, `:AgentReview` in the root opens it in its owner, and `agent-review skip <id>` from the root clears it in one step with no agent turn.

Plan and rationale: `docs/workflows/agent-review-cross-worktree-plan.md`. Decisions from the grill (2026-10-19):
- Q1: the CLI (`scripts/agent-review`, Python) is the single source of cross-worktree discovery. Neovim shells out to `agent-review list --all --json` and acts in the returned owner.
- Q2: Phase 1 = CLI (`list --all`, landed and orphan flags, `approve <id>` and `skip <id>` resolving the owner) + Neovim on the CLI with a picker. Session-band, the Pi refusal message and delegate-pi are Phase 2 (separate spec).
- Q3: `skip <id>` consumes directly, like `approve`: it writes the decision, deletes the pending record and `refs/agent-review/<id>/*`, and refuses while `<id>.processing` exists. A live Pi watcher then finds no pending record and sends nothing.
- Q4: "landed" = the run's `base..end` diff reverse-applies cleanly (`git apply --reverse --check --cached`) to the last-fetched `origin/<default>` tree in a temporary index. No network; the worktree and real index are never touched. Binaries, renames and any error count as not landed.
- Q5: `:AgentReview` opens a single pending review directly (tcd to the owner). With more than one it shows a `vim.ui.select` picker, oldest first, with name, branch, worktree, age and `[landed]`. Orphans are listed but not openable. If the CLI is missing or fails, it falls back to today's current-root scan with a warning.

Terms: **owner** = the worktree whose `.pi/agent-review/pending/` holds the record. **Orphan** = `refs/agent-review/<id>/*` exist but no worktree holds a pending record for `<id>`.

## Acceptance Criteria
- AC-1: `list --all --json` from the root lists a review pending only in another worktree, with owner, branch, name, runId, startedAt, landed and orphan fields
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "list --all finds a review pending in another worktree"`
- AC-2: A review whose changes are already on origin's default branch is flagged landed
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "landed when main contains the run"`
- AC-3: A review whose changes are not on main is not flagged landed, and the landed check leaves the worktree and its index unchanged
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "not landed and touches nothing"`
- AC-4: Leftover refs with no pending record anywhere are listed as an orphan
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "orphan refs are listed"`
- AC-5: `approve <id>` run from the root acts in the owning worktree (decision written there, pending removed there, endTree check still enforced)
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "approve by id from the root acts in the owner"`
- AC-6: `skip <id>` from the root or a sibling worktree removes the pending record and refs in one step, and a live Pi session in the owner sends no follow-up
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "skip by id consumes with no follow-up"`
- AC-7: `skip <id>` refuses and changes nothing while `<id>.processing` exists
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "skip refuses during processing"`
- AC-8: `skip <id>` on an orphan deletes its refs
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "skip clears orphan refs"`
- AC-9: The Pi input gate in one worktree is not blocked by a review pending in another worktree
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.xwt.test.ts -t "gate stays per worktree"`
- AC-10: `:AgentReview` with one review pending in another worktree opens it and sets the tab directory to the owner, even when the root holds a stale record that the CLI reports as landed
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua single_opens_owner`
- AC-11: `:AgentReview` with several pending reviews offers a picker ordered oldest first, with a `[landed]` tag, and orphans not openable
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua picker_order_and_tags`
- AC-12: `:AgentReview` falls back to the current-root scan with a warning when the CLI fails
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua cli_failure_fallback`
- AC-13: Existing extension and CLI tests still pass
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test`
  baseline: pass
- AC-14: Existing Neovim agent-review checks still pass
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-test.lua`
  baseline: pass
- AC-15: The workflow doc documents `list --all`, `approve <id>` and `skip <id>` from any worktree
  verify: `rg -q "list --all" docs/workflows/agent-review.md && rg -q "skip <id>" docs/workflows/agent-review.md`
- AC-16: Use-test: a pueue Pi run dispatched with `-w` into a worktree appears from the root via `agent-review list --all` and `:AgentReview`, and reject edits only that worktree
  verify: manual - live use-test with real pueue, Pi and Neovim

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
- Act on a run only in its owner worktree (`cwd=owner` or `tcd owner`)
- Keep storage per worktree: pending, decisions and the Pi watcher stay together
- Build in Claude, not Pi (review-gate code, `plan-handoff.md`)
### Ask first
- Any change to the Pi input gate or to `processDecision`
- New dependencies; any network access in the landed check
### Never
- Edit a `verify:` line, a `baseline:` line or an existing test to make a check pass (one exception, granted by the person on 2026-10-19: `agent-review.approve.test.ts` "a linked worktree approves its own run; the main checkout does not see it" asserted the old per-worktree `approve`, which contradicts AC-5; it was rewritten to the new contract)
- Run `ac-run approve` or approve an agent run on the person's behalf
- Make one worktree's pending review block Pi in another worktree

## Open Questions
- Default branch for the landed check: Default `git symbolic-ref refs/remotes/origin/HEAD`, falling back to `origin/main`; no fetch.
- Cost of `list --all` per Neovim open (one subprocess plus one landed check per record): Default accept; revisit if it exceeds ~300 ms on this repo's ~30 worktrees.
- Should `status` (without `--all`) change? Default no; `--all` is additive.
- Phase 2 (session-band aggregation, Pi refusal message naming the owner, delegate-pi dispatch note): Default separate spec after Phase 1 merges.
- `SPEC.md` on main is the stale design-brief spec carried in by #119: Default leave it; this branch replaces it on merge.
