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

**Run start** (human-sourced `input`, mode `on`):
- Snapshot the full working tree, including untracked non-ignored files, without touching the
  working tree or the real index: `GIT_INDEX_FILE=<tmp> git add -A && git write-tree`, then
  `git commit-tree <tree> -m agent-review-base` → store as `refs/agent-review/<run-id>/base`.
- Record the mode file's mtime.

**Run end** (`agent_settled` after verification, mode was `on` at run start):
- Snapshot again → `refs/agent-review/<run-id>/end`.
- If `base` and `end` trees are identical, the run changed nothing: clean up refs, no review.
- Otherwise write `.pi/agent-review/pending/<run-id>.json`:
  `{runId, base, end, files: [...], startedAt, endedAt}`.
- **Tamper check:** if the mode file's mtime changed during the run, the agent (or something
  running inside the run) altered review mode. Force mode back to `on`, keep this run's review,
  and surface `review mode changed during run` in the pending record so the pill can show it.

**While a review is pending:**
- Show a status in Pi (`review pending — :AgentReview in nvim`).
- **Verify first** whether a Pi `input` handler can cancel a submission. If it can: block new
  human runs until the review is decided, with `/review skip <run-id>` as an explicit escape
  that records `skipped` in the decision log. If it cannot: do not block; warn in Pi and let the
  pill carry the signal. Record which behavior was implemented.

**Decision arrives** (watch `.pi/agent-review/decisions/<run-id>.json`):
- Validate before acting: the record's `end` must equal this run's recorded `end` ref, and its
  `final` tree must equal a fresh snapshot of the current working tree. If either fails, ignore
  the file, keep the review pending, and warn — this rejects forged or stale decision files.
- If the human changed nothing (no rejections, no edits, no notes): mark done, send nothing,
  so no new agent turn is triggered.
- Otherwise send **one** message via `pi.sendUserMessage(..., { deliverAs: "followUp" })`:
  `Review of run <id>: <n> files changed by the reviewer. Decisions, notes and the reviewer's
  patch: .pi/agent-review/decisions/<id>.json. Re-read the listed files before further changes.
  Do not reintroduce rejected changes.`
- Clean up `refs/agent-review/<run-id>/*` after a decision; prune any older than 7 days on
  `session_start`.

**Non-interactive Pi** (`pi -p`, no TUI) with mode `on`: do not auto-accept. Leave the pending
record, print a warning, and exit non-zero if the harness allows it. This deliberately differs
from DiffViewer, which auto-applies with zero review outside the TUI.

**Override shortcut:** `pi.registerShortcut` toggling mode for the next run, with
`setBy: "human"`. Outside a run it writes the mode file immediately. During a run it only queues
the change in memory and writes the file after that run ends, so a human toggle never trips the
tamper check. For the same reason, change mode with the `agent-review` CLI only between runs —
a CLI write during a run is indistinguishable from the agent doing it and will be flagged.

### 3. Neovim module — `nvim/.config/nvim/lua/custom/agent_review.lua`

- `:AgentReview` — open the oldest pending run for the current repo:
  `DiffviewOpen <base-commit>` (compares base against the working tree, which currently holds the
  agent's end state) and `:Gitsigns change_base <base-commit>` so gitsigns navigates and resets
  hunks against the run's base.
  - **Accept** a hunk: leave it.
  - **Reject** a hunk: `:Gitsigns reset_hunk` (restores base content in the working tree).
  - **Edit** a hunk: edit the buffer normally.
- `:AgentReviewNote` — prompt for a note on the cursor line, appended to an in-progress notes
  list `{file, line, note}`.
- `:AgentReviewDone` — snapshot the working tree as `final`, compute `git diff <end> <final>`
  and save it as the reviewer's patch. That single patch exactly encodes every rejection and
  edit relative to what the agent produced; an empty patch means everything was accepted. Write
  `.pi/agent-review/decisions/<run-id>.json` atomically:
  `{runId, base, end, final, files: [{path, status: "accepted"|"changed"}], notes, patch}`.
  Close diffview, reset gitsigns base, remove the pending file.
- Keymaps: `<leader>ar` review, `<leader>an` note, `<leader>ad` done. Register them in the
  existing keymap setup; check for collisions first.

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

## Verification

- A run that changes nothing produces no pending review.
- A run with mode off produces no pending review; with no mode file, it does.
- Reject one hunk, edit one, accept one, add a note → the decision patch contains exactly the
  rejection and edit; Pi receives exactly one follow-up message referencing the file.
- Accept everything with no notes → no follow-up message, no new agent turn.
- A verifier repair cycle inside a run → a single pending review covering the final state.
- Changing the mode file from inside a Pi run → tamper flag set, mode forced on.
- A decision file whose `end` or `final` doesn't match → ignored, review stays pending.
- `pi -p` with mode on → no auto-accept, pending record left behind.
- With `agent-review` enabled, `pi-diff-review` does not also open a review.
