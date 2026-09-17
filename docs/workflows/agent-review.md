# Agent Review — Work Order

Status: ready, 2026-09-16. Human-in-the-loop review of Pi's changes, once per run, in Neovim.
Depends on nothing blocking; integrates with `agent-flow.md` (pill state, slice 4 guard).

## Decisions (from design interview)

1. **Toggle:** each work-order phase declares `Review: on|off` at planning time. A one-key
   override flips it for the next run. **The mode is set only by a human** (or, later, the
   agent-flow bridge acting on a phase you approved) — never by the agent under review.
2. **Timing:** one review per Pi run, covering everything that run changed.
3. **Surface:** Neovim, using tools already installed — `diffview.nvim` for the diff,
   `gitsigns.nvim` for hunk navigation and reset, real buffers for editing.
4. **Feedback:** decisions plus optional per-line notes go into a record file; Pi is told the
   file's path in a single message. No pasted text.
5. **Scope:** Pi only. Claude Code keeps its built-in edit approval.

## Relationship to existing review tools

- **DiffViewer `pi-diff-review`** has real measured use (249 decisions) but reviews per edit,
  in its own tmux pane, and cannot open Neovim. This work order builds its replacement **as a
  trial**, not a deletion: while `agent-review` is in trial, `pi-diff-review` must be disabled
  by default without uninstalling (if no persistent disable exists, remove its package entry —
  reversible with `pi install ~/repos/DiffViewer/pi-extension` — and note that in the trial
  manifest). **Two review gates must never be active at once**; every edit would be reviewed
  twice. At trial expiry, `scripts/trial-usage.sh` decides which one stays.
- **`pi-review-gate.ts`** and `lib/nvim-rpc.ts` remain slated for deletion (consolidation
  Phase 5). Nothing here reuses them.
- DiffViewer's herdr pane-spawn bug does not need fixing for this work, since its pane is not
  used. Do not fix it as part of this order.

## What a "run" is

A run starts at a human-sourced `input` event (`event.source !== "extension"`) and ends at the
`agent_settled` that follows **after `post-run-verifier` has finished**, including its repair
cycles. Verifier repair turns are extension-sourced inputs and belong to the same run. If
review snapshotted before verification settles, you would review a diff the verifier then
changes. Ensure `agent-review`'s `agent_settled` handler runs after the verifier's (check how
Pi orders handlers across extensions; if order is not guaranteed, have `agent-review` wait for
the verifier's completion signal or re-check that no verifier cycle is pending).

## Components

### Review history

- First review (of `edbcff8`): "Review findings this revision fixes" below.
- Re-review (of the rebuild, `93b18c8`): `agent-review-rereview-2026-09-17.md`. **Read it before
  implementing**; its N1–N8 findings are the known defects the contract tests target.

### Scope and contract for v1 — 2026-09-17

Two implementation rounds failed review the same way: "done" was reported, the tests did not
exercise the extension, and the Verification list was never run. v1 therefore changes two things:

**1. Scope is cut to the core gate.** Deferred to v2, and not to be built now:
- the override shortcut (`agent-review mode on|off` between runs covers toggling);
- print-mode (`pi -p`) handling and non-zero exit;
- the 7-day ref prune on `session_start`;
- multi-session guarantees beyond the claim-by-rename already specified.

Everything else in components 2 and 3 is v1.

**2. Tests come first, written by the planner, not the implementer.**
`pi/.pi/agent/extensions-available/agent-review/agent-review.integration.test.ts` drives the real
extension through a fake Pi against temporary git repos. **Pi implements until it passes, and must
not edit that file.** If a test looks wrong, stop and report it. The test is the contract: a change
that passes by weakening it does not count. Run it with
`node --test agent-review.integration.test.ts` from that directory, and show the full output.

**3. Develop outside the loaded extensions directory.** Pi loads every top-level `*.ts`/`*.js` in
`~/.pi/agent/extensions/` as an extension (`loader.js:528`), and the `pi` stow package links those
files individually. So any restow would put `agent-review.ts` live next to `pi-diff-review` (two
gates at once, against this spec), and would also load `agent-review.test.ts` as an extension that
runs its tests on every Pi start. Therefore:
- Move the extension to `pi/.pi/agent/extensions-available/agent-review/index.ts`, and all its
  tests into that directory. `extensions-available/` is not loaded by Pi.
- Delete `pi/.pi/agent/extensions/agent-review.ts` and `agent-review.test.ts` from the loaded
  directory.
- Enabling it is a deliberate step during verification: `git mv` the directory to
  `pi/.pi/agent/extensions/agent-review/` and restow, in the same step that disables
  `pi-diff-review`. Pi loads only a subdirectory's `index.ts`, so the tests inside it are never
  loaded as extensions. Disabling it again is the reverse move plus restow.
- **Until then, do not run `scripts/restow.sh` or `stow -R pi`** while `agent-review.ts` sits in the
  loaded directory.

### Input-cancellation check — 2026-09-17

Verified from Pi’s extension API: an `input` handler returning
`{ action: "handled" }` skips agent processing. Extension commands dispatch
before `input`, so `/review skip <run-id>` remains an explicit escape while a
review is pending. Component 2 implements that blocking behavior.

Build as three separate commits, in this order.

### 1. Mode CLI — `scripts/agent-review`

- `agent-review mode on|off` writes `.pi/agent-review/mode.json`:
  `{"mode": "on"|"off", "setBy": "<human|bridge>", "at": <iso>}`. Write atomically (tmp + rename).
- `agent-review status` prints mode, pending runs, last decision.
- **No mode file means `on`.** Fail closed: forgetting to declare a phase costs one extra
  review, never a skipped one.
- Add `.pi/agent-review/` to the repo `.gitignore` template that `scripts/agent-workflow attach`
  manages.

### 2. Pi extension — `pi/.pi/agent/extensions/agent-review.ts`

**Revision 2026-09-17.** The first implementation (`edbcff8`) failed review; see "Review findings
this revision fixes" below. Two of those failures came from contradictions in the earlier version
of this spec, which are corrected here.

**Shared rules for both components:**
- **Repo root.** Resolve once with `git rev-parse --show-toplevel` from the starting directory.
  Every path (`.pi/agent-review/…`) is relative to that root, in Pi, the CLI and Neovim alike.
- **Snapshot** = full working tree including untracked non-ignored files, **excluding
  `.pi/agent-review/`**, without touching the real index or working tree:
  `GIT_INDEX_FILE=<tmp> git add -A -- . ':(exclude).pi/agent-review'`, then `git write-tree`
  (the **tree**), then `git commit-tree <tree> -m <label>` (the **commit**, only so refs keep the
  object alive). The exclusion is mandatory even where `.pi/agent-review/` is gitignored, because
  review state changes between snapshots and would otherwise change the tree.
- **Compare trees, never commits.** `commit-tree` output includes a timestamp, so two snapshots of
  identical content have different commit hashes. Every equality check below uses tree hashes.
- **Validate identifiers before use** in any path, git argument, Neovim command, or prompt text:
  `runId` must be a UUID and equal the file's basename; hashes must match `^[0-9a-f]{40}$`.
- **Record shapes** (use `file`, not `path`, everywhere):
  - pending: `{runId, base, baseTree, end, endTree, files: [{file}], startedAt, endedAt,
    modeMtimeMs, tamper?: true, error?: string}`
  - decision: `{runId, endTree, finalTree, files: [{file, status: "accepted"|"changed"}],
    notes: [{file, line, note}], patch, skipped?: true}`

**Run start** (mode `on`, and either a human-sourced `input` **or** agent-review's own review
follow-up message):
- Pi delivers agent-review's follow-up with `source: "extension"`. Mark that message (e.g. an
  in-memory token set just before `sendUserMessage`) so it starts a reviewed run. Otherwise the
  agent's response to your review, the edits it makes after reading your decision, would never be
  reviewed. Other extension-sourced inputs (verifier repairs) still belong to the current run.
- Snapshot → store `refs/agent-review/<run-id>/base`; keep `baseTree`. Record the mode file's mtime.
- **If the start snapshot fails, fail closed:** do not let the input proceed. Return
  `{ action: "handled" }`, show the error, and write a pending record with `error` so the block is
  visible and skippable. A run that cannot be snapshotted must not run unreviewed.

**Run end** — the run ends only after `post-run-verifier` has finished, including any repair
cycle it dispatches:
- `post-run-verifier` emits its settled signal only when that settle dispatched **no** repair
  follow-up, and resets the flag on every `agent_start`. A settle that dispatches a repair is not
  the end of the run.
- If `post-run-verifier` is not loaded, or sends no settled signal within 30 s of `agent_settled`,
  agent-review finishes anyway. A missing verifier must not leave the run open. **Cancel that
  timer on every `agent_start` and every extension-sourced input during the active run**, and
  re-arm it only at the next `agent_settled`. A repair turn that takes longer than 30 s must never
  be snapshotted mid-repair.
- Snapshot → `refs/agent-review/<run-id>/end`; keep `endTree`.
- If `endTree === baseTree`: the run changed nothing. Delete both refs, no review.
- Otherwise write the pending record atomically. **Clear the active run only after that write
  succeeds.**
- **Fail closed on errors.** If a snapshot, ref update, or write fails, write a pending record
  with `error` set (it blocks like any pending review and can be skipped). Never drop the run
  silently: a lost review means an unreviewed run.
- **Tamper check:** if the mode file's mtime changed during the run, set `tamper: true`, force mode
  back to `on`, and keep the review. Take the mtime reading **before** writing any queued human
  mode change (see Override shortcut).
- Performance: seed the temp index by copying the real index before `git add -A`, so a snapshot
  doesn't rehash the whole repo. Locate it with `git rev-parse --git-path index`, since `.git` is
  a file inside worktrees.

**While a review is pending:**
- Pi's `input` handler returning `{ action: "handled" }` skips agent processing (verified
  2026-09-17). Block **all** inputs, human- and extension-sourced alike, while any pending record
  exists. `/review …` commands dispatch before `input` and stay available.
- `/review skip <run-id>` writes a decision with `skipped: true`, the current `endTree` and a
  fresh `finalTree`, which then flows through normal validation.
- **Exception for `error` records:** `/review skip <run-id>` on a pending record with `error` set
  removes it directly, without snapshot validation. The error may be a snapshot that keeps
  failing, and requiring one to clear it would lock input permanently. `/review` is a slash
  command rather than a file the agent can forge, but see Known limits: an agent inside herdr can
  still type it. Show the error text when skipping, and suggest `agent-review mode off` if
  snapshots keep failing.
- Show `review pending — :AgentReview in nvim` in Pi, and restore that status on `session_start`
  from any pending records already on disk.

**Decision arrives** (watch `.pi/agent-review/decisions/`):
- **Pi owns the pending record.** Neovim never deletes it.
- Ignore `*.tmp` names. Keep an in-flight set per `runId`, and claim a decision by renaming its
  pending record to `<run-id>.processing` before validating, so duplicate filesystem events or a
  second Pi session cannot process it twice.
- Validate: identifiers as above, `decision.endTree === pending.endTree`, and
  `decision.finalTree ===` the tree of a fresh snapshot. **On any failure:** rename `.processing`
  back to pending, warn, and stop. The review stays pending.
- On success: delete the `.processing` record and both refs.
  - Decision has an empty `patch`, no notes, and isn't `skipped`: send nothing, so no new agent
    turn starts.
  - Otherwise send **exactly one** `pi.sendUserMessage(..., { deliverAs: "followUp" })` with fixed
    text. Only the validated `runId` and the fixed decision path may be interpolated:
    `Review of run <id> is complete. Decisions, notes and the reviewer's patch:
    .pi/agent-review/decisions/<id>.json. Re-read the listed files before further changes. Do not
    reintroduce rejected changes.`
- On `session_start`, prune `refs/agent-review/*` whose run has no pending record and is older
  than 7 days.

**Non-interactive Pi** (`pi -p`, no TUI) with mode `on`: never auto-accept. Leave the pending
record, print why, and exit non-zero. If a review is already pending when `pi -p` starts, print that
input is blocked by review `<id>` and exit non-zero. Never silently swallow the input.

**Override shortcut:** `pi.registerShortcut` toggles mode for the next run with
`setBy: "human"`. Outside a run it writes the mode file immediately. During a run it queues the
change in memory and writes it only after run-end has read the tamper mtime and written the pending
record, so a human toggle never trips the tamper check. Change mode with the `agent-review` CLI only
between runs; a CLI write during a run is indistinguishable from the agent doing it.

**Tests** must include an integration test against a temporary git repo, not only pure predicates:
snapshot tree equality across two snapshots of unchanged content, a no-change run, a decision round
trip, a forged `endTree` rejected, a skip, duplicate watcher events yielding one follow-up, and a
repair cycle producing one review. Pure predicate tests passed while the first implementation
could never work end to end.

### 3. Neovim module — `nvim/.config/nvim/lua/custom/agent_review.lua`

Follows the shared rules in component 2: repo root, snapshot with the `.pi/agent-review`
exclusion, tree comparison, identifier validation, and record shapes.

- `:AgentReview` — open the oldest pending run for the repo root (skip `.processing` and records
  whose identifiers fail validation). Use the Lua APIs, never string-built commands:
  `require("diffview").open({ base })` or the equivalent argv form, and
  `require("gitsigns").change_base(base, true)`, so gitsigns navigates and resets hunks against
  the run's base.
  - **Accept** a hunk: leave it.
  - **Reject** a hunk: gitsigns `reset_hunk` (restores base content in the working tree).
  - **Edit** a hunk: edit the buffer normally.
- `:AgentReviewNote` — prompt for a note on the cursor line, appended as `{file, line, note}`.
  `file` is the repo-relative path of the real file. Inside diffview panes, resolve the underlying
  path, never store a `diffview://` buffer name.
- `:AgentReviewDone` — take a snapshot with the shared method and keep its **tree** as
  `finalTree`. Compute `git diff <endTree> <finalTree>` as the reviewer's patch: it encodes every
  rejection and edit relative to what the agent produced, and is empty if everything was accepted.
  Write `.pi/agent-review/decisions/<run-id>.json` atomically (tmp name ending in `.tmp`, then
  rename) in the decision shape. Close diffview and restore gitsigns with its `reset_base`. **Do
  not delete the pending record** — Pi removes it after validating. Wrap the whole command in
  `pcall` and report failures instead of erroring half-way.
- Keymaps: `<leader>ar` review, `<leader>an` note, **`<leader>aD`** done. `<leader>ad` is taken
  by Evidence's DAP snapshot (`lua/custom/plugins/evidence.lua:425`). Add all three to the
  which-key group in `init.lua` with accurate labels.

## Review findings this revision fixes (2026-09-17)

From the review of `edbcff8` and the staged Neovim module. Items marked **spec error** were caused
by the earlier text of this document.

1. Commit hashes were compared instead of trees, so no run was ever "unchanged" and every decision,
   including `/review skip`, failed validation. **Spec error in part:** the spec stored commits but
   asked for tree comparisons without saying so everywhere.
2. `.pi/agent-review/` was inside the snapshots, so writing review state changed the tree between
   `finalTree` and Pi's check. **Spec error:** the exclusion was only added to a gitignore template.
3. Neovim deleted the pending record, which Pi's watcher needs, and which a failed validation must
   keep. **Spec error:** the spec said both "remove the pending file" and "keep the review pending".
4. The run could stay open forever if the verifier never signalled, silently skipping review for
   the rest of the session, and a git error dropped the review. Now: timeout fallback, fail closed.
5. The verifier signalled settled even when it had just dispatched a repair, so repair edits
   appeared as reviewer edits.
6. Pi used its working directory while the CLI and Neovim used the repo root.
7. `<leader>ad` collided with Evidence.
8. Duplicate filesystem events could send duplicate follow-ups.
9. Identifiers from agent-writable files were used unvalidated in paths, Neovim commands, and the
   prompt.
10. Missing: shortcut, ref pruning, no-change ref cleanup, status restore on `session_start`,
    non-zero exit in print mode, blocking of extension-sourced input while pending.

## Integration with agent-flow.md

- **Pill:** add a `review` state for the `build` role, e.g. `build ⧗ review 3 files`, derived
  from `.pi/agent-review/pending/` via file-system events in the bridge daemon (fswatch/kqueue),
  not polling. Show `⚠ review mode changed` when a pending record carries the tamper flag.
- **Escalation (slice 3):** a pending review counts like `blocked` — escalate once if untouched
  for N minutes.
- **Slice 4 guard:** a pending review makes Pi not-idle for the bridge regardless of its herdr
  status. The bridge must not prompt Pi, or chain Pi's `NEXT:` to Claude, until the review is
  decided. Review-driven fix runs are human-initiated and do not count toward the 3 round-trip
  cap. When the bridge dispatches an approved phase, it sets review mode from that phase's
  `Review:` declaration with `setBy: "bridge"`.
- **Work orders:** every phase heading gains a `Review: on|off` line. Undeclared means `on`.

## Trial

Add to `~/.claude/trial/manifest.json` (consolidation Phase 7): name `agent-review`, competitor
`pi-diff-review`, expiry 30 days after the first decided review. Usage = count of files in
`.pi/agent-review/decisions/`, compared with `pi-diff-review`'s `decisions.jsonl` count over the
same window.

## Known limits (document, don't solve)

- **Review is post-hoc.** Tests and the verifier execute the agent's unreviewed code during the
  run. Review controls what stays, not what runs.
- **Shared working tree.** Changes made by you or another session during a Pi run appear in that
  run's diff.
- **No sandbox.** The agent can technically write any file, including `.pi/agent-review/`. The
  tamper check and decision validation catch the obvious forgeries; they are not a security
  boundary.
- **The agent can type into its own pane.** Inside herdr, Pi can run
  `herdr agent prompt <own pane> "/review skip <id>"` and clear its own review. `agent-flow.md`
  forbids agents from calling `herdr agent prompt`, but that is a rule, not enforcement. The gate
  keeps honest-but-sloppy agents in check; it does not stop a deliberately adversarial one.

## Verification

- A run that changes nothing produces no pending review.
- A run with mode off produces no pending review; with no mode file, it does.
- Reject one hunk, edit one, accept one, add a note → the decision patch contains exactly the
  rejection and edit; Pi receives exactly one follow-up message referencing the file.
- Accept everything with no notes → no follow-up message, no new agent turn.
- A verifier repair cycle inside a run → a single pending review covering the final state.
- Changing the mode file from inside a Pi run → tamper flag set, mode forced on.
- A decision file whose `end` or `final` doesn't match → ignored, review stays pending.
- `pi -p` with mode on → no auto-accept, pending record left behind, non-zero exit.
- With `agent-review` enabled, `pi-diff-review` does not also open a review.
- `/review skip <id>` clears a pending review, and the next input runs.
- Pi started from a subdirectory → mode, pending, and decisions all land under the repo root, and
  `:AgentReview` finds them.
- Verifier extension not loaded → the run still ends and produces a pending review.
- A pending record whose `runId` is not a UUID, or doesn't match its filename → ignored by Pi and
  Neovim, never used in a path.
- A git failure during the end snapshot → pending record with `error`, input blocked.

**Stow order for verification.** `agent-review.ts` is not stowed yet, so it has never loaded.
Stowing it while `pi-diff-review` is enabled would run two review gates at once. For the real
verification run: disable `pi-diff-review`, stow `agent-review`, run this list. If verification
fails, unstow `agent-review` and re-enable `pi-diff-review` before stopping. Don't leave the repo
with no review gate.
