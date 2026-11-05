# Band-only spec approval; no review gate

## Context

Two gates add friction for the person and for unattended agents. `spec approve` needs a macOS
dialog (on Linux, #247 turns it off), and the Pi review gate locks Pi's input and ends unattended
runs with exit 3 until someone runs `agent-review approve` or `:AgentReviewDone`. After this change:

- The only approval left is for a spec. It pops up as Approve/Deny in the session-band mod, the same
  way blast radius pops up for risky Bash commands.
- Pi runs finish without waiting. `:AgentReview` stays for browsing the diff, adding notes and making
  quick edits. Sending those to Pi is optional.
- What still catches mistakes: git and jj history, the blast-radius Allow/Deny on Bash commands, and
  the other guards that exist today (secrets, destructive commands, edits to settings and hooks).

Decisions (2026-11-05):

| Topic | Decision |
|---|---|
| How a spec approval appears | Pops when ready: a lint-clean draft makes the band pop Approve/Deny |
| What happens when a Pi run finishes | Accepted automatically; notes are sent optionally |
| Who edits the protected files | The person applies prepared patches |
| Deny rules and gate-guard rules for approval | Removed |

Trade-off of removing the deny rules: an agent can now run `spec approve` itself. The guard against
that becomes the written rules plus git history. A record written this way can be seen afterwards,
because the record holds its own approval timestamp and the `status:` line changes in a commit.

Supersedes #247 (Linux skips the dialog): close it after phase 1 merges. Also supersedes the
`gates-bulk` spec (bulk approve through the dialog): archive it, then remove the gates-bulk worktree.

## Protected files (the person applies these)

Claude's deny rules block agent edits to the files below, and the Pi gate guard blocks Pi from
editing them:

- `scripts/spec`
- `scripts/agent-review`
- `claude/.claude/settings.json`
- `pi/.pi/agent/extensions/lib/gate-guard-core.ts`
- `pi/.pi/agent/extensions/gate-guard.ts`

For each of these, the phase writes `docs/plans/patches/<n>-<file>.patch`. The person runs
`git apply` in the phase's worktree and commits. Everything else is dispatched to Pi as usual.

## Phase 1: `scripts/spec` without a dialog (patch, person applies)

- Delete `confirm()` (:208-239), including the osascript and Linux branches.
  - `cmd_approve` now: print the summary, take the baseline, write the record, set `status: approved`.
  - It no longer asks anything.
- On success, `lint` with `status: draft` writes a ready marker:
  - Path: `~/.local/state/ac-run/ready/<hash>.json`.
  - Fields: `{spec, branch, hash, ts}`.
  - `approve` and `reject` delete the marker.
- `HUMAN` text (:24) becomes: "Ready for approval: approve or deny in the session-band prompt or the /gates pane."
- Tests in `scripts/tests/test_spec_loop.py`:
  - Drop the confirm/dialog tests (:305-460 confirm_* and approve_refused/ignores_stdin).
  - `approve_inproc` no longer patches `confirm`.
  - Add tests: lint writes the marker; approve and reject remove it.
- Unchanged: the record format, `check`, `status`, `pi-queue spec-approved`, `pi-checks`.

## Phase 2: Approve/Deny in the band (Pi)

- New file `session-band-plugin/hooks/spec-ready.tsx`. On each heartbeat tick it reads the
  `ready/*.json` markers.
- For each marker not already asked this session, and only when `isInteractive`:
  - Show the `spec show` summary in a read-only pane, reusing the `blast-pane.tsx` pattern.
  - Ask: `$.ui.ask(summary + "\n\nApprove this spec?", ['Approve','Deny'])`.
  - **Approve** runs `spec approve <path>`. Use `approveTimeoutMs`, because the baseline runs every verify command.
  - **Deny** runs `spec reject <path>`.
  - **Dismiss** leaves the marker in place and records it as asked for this session. /gates still lists it.
- `/gates` (`gates.tsx`) and `/diff-review` spec tabs (`review-pane.tsx:402-407`): `a` asks the same
  `$.ui.ask` before calling `spec approve`.
- Remove review rows from /gates: there is no review approval any more.
- Tests:
  - New `spec-ready.test.ts`, modelled on `blast.test.ts` (Approve, Deny, dismiss, non-interactive).
  - Update `gates-pane.test.ts`, `gates.test.ts` and `review-pane.test.ts`.

## Phase 3: Pi runs finish on their own (Pi, plus an agent-review patch)

- `pi/.pi/agent/extensions/agent-review/index.ts`:
  - Keep the run's base and end refs and a run record, so `:AgentReview` can still browse the diff.
  - Write the record as `landed`, not `pending`.
  - Remove the input refusal (:545-560) and the exit-3 print path (:181, :412-416).
  - `processDecision` (:459-500) still sends a follow-up when a decision arrives that has notes, edits or a patch.
- `scripts/agent-review` (patch, person applies):
  - Remove `approve` and `confirm()`.
  - `list` shows landed runs for browsing.
  - Keep `skip` (rename it `dismiss`), `status` and `register`.
- Neovim `lua/custom/agent_review.lua`:
  - `AgentReviewDone` becomes `AgentReviewSend` (`<leader>aS`, which-key "Agent: send notes and edits").
  - It writes a decision only when there are notes or changed files.
  - `RejectAll` restores the files and then sends.
  - The dashboard counts runs that have unsent notes, not runs "waiting for approval".
- Remove the waits on review state:
  - the `review-decided` template in `pi-queue-templates.json`;
  - `fact_review_decided` in `pi-queue`;
  - the review step in `pi-wait`;
  - the exit-3 and review-pending branches in `outcome.ts`, `history.ts`, `handoff.ts` and `pi-outcome`;
  - the review-batch note in `pi-checks.mjs`.
- Tests: the Pi `agent-review.*.test.ts` files, `agent-review-nvim-test.lua`, `test_pi_wait.py`,
  `test_pi_queue.py`, and the band's outcome, history and handoff tests.

## Phase 4: Guards, rules and docs

- **`claude/.claude/settings.json`** (patch, person applies):
  - Delete these deny rules: `Bash(*agent-review approve*)` ×2, `Bash(*spec approve*)` ×2,
    `Bash(*.local/state/ac-run*)`, `Bash(*agent-review/decisions*)`,
    `Edit(~/.local/state/ac-run/**)`, `Edit(**/.pi/agent-review/decisions/**)`.
  - Update the autoMode text at :593 and :620.
  - Keep the settings, hooks and guard-file edit denies.
- **`gate-guard-core.ts`** (patch, person applies):
  - Drop `STATE` and the approve regex in `BASH`.
  - Keep `GUARDS`.
  - Update `lib/gate-guard.test.ts`.
- **Spec-loop block.** You asked for this change explicitly, as the static-block rule requires:
  - Rule 2 becomes: "Approve a spec only through the session-band prompt or /gates; an agent stops at a lint-clean draft."
  - Rule 7 drops "Approval records live outside the repo".
  - Edit both copies identically: `shared/AGENTS.md:238-248` and `shared/research-tool-routing.md:82-92`.
  - Rebuild `pi/.pi/agent/AGENTS.md` with `scripts/build-pi-agents`.
- **`claude/.claude/rules/plan-handoff.md`:**
  - Drop "Never run `agent-review approve`".
  - `:AgentReview` becomes "optional browse, notes and edits".
- **Docs:**
  - `docs/workflows/agent-review.md`, `README.md` (:14, :46-56, :125), `docs/workflows/plan-first-pi-handoff.md`, `scripts/agent_handoff.py:64-67`.
  - Skills: `verify-spec`, `grill-me` and `delegate-pi` (:129).
- **Outside this repo:** `send-it.md` lives in llm-wiki. Make a separate small PR there.

## Order and dispatch

Each phase is its own branch and its own draft PR, labelled `machine:mac`:

1. Phase 1 (patch) merges first. Phase 2 depends on the marker; phase 4 depends on both.
2. Phase 2 and phase 3 are separate Pi dispatches: `pueue add -w <worktree>`, `pi-view --tui`, high tier (`opencode-go/claude-haiku-5-5:off`).
3. Close #247 and archive the gates-bulk spec after phase 1.

## Verification

- `python3 -m pytest scripts/tests` passes.
- The session-band plugin tests pass (`bun test` in `session-band-plugin/`).
- The Pi extension tests pass.
- `scripts/build-pi-agents --check` passes.
- `test_rule_blocks_identical` passes.
- `nvim --headless` runs the agent-review Lua tests.
- Live check: in a scratch worktree, write a SPEC.md and run `spec lint`.
  - The band pops Approve/Deny.
  - Approve leads to `spec status` exit 0 and `spec check` running.
  - Deny leaves the spec as a draft.
- Live check: dispatch a tiny Pi task.
  - The pueue task ends Success with no input lock.
  - `:AgentReview` opens the diff.
  - `<leader>aS` with a note sends a follow-up to Pi.
