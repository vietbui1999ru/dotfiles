---
status: draft
branch: gates-bulk
---
# SPEC: Bulk Approve, Skip and Reject in the Gates pane

## Objective
The session-band `/gates` pane can act on one gate row, on several marked rows, or on every row.
Review rows get a Skip button that runs `agent-review skip` directly. Today `x` ("Reject all") on
a non-orphan review sends `:AgentReviewRejectAll <runId>` to a Neovim server in the review's
worktree and fails with "Could not send Reject all to Neovim" when none is listening; only orphan
rows run skip. The gate's own confirmation (the per-run macOS dialog in `scripts/agent-review approve`
and `scripts/ac-run approve`) is unchanged.

Context, read 2026-10-21 at dotfiles main 205fe6f: `session-band-plugin/hooks/gates.ts` holds the
row types and argv builders (`acRunArgv`, `skipArgv`, `REVIEW_LIST_ARGV`); `gates.tsx` holds
`GatesState`, `approve` (lines 125-156), `reject` (158-190; orphan reviews run `agent-review skip`,
other reviews send `AgentReviewRejectAll` to Neovim via `reviewRemoteArgv` in `pane.tsx:294`, specs
run `ac-run reject`; two-press via `needsRejectConfirm`) and the buttons (222-234, hotkeys
j k a x e o r b f w q plus `JUMP_KEYS`).

## Acceptance Criteria
- AC-1: On any review row (orphan or not) the `x` button is labelled Skip and runs `agent-review skip`, needing no Neovim server; on a spec row it stays Reject and runs `ac-run reject`
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "review row offers skip"`
- AC-2: One key toggles a mark on the selected row, another marks every row or clears all marks, and marked rows show a marker
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "rows can be marked and cleared"`
- AC-3: Approve, Skip and Reject act on the marked rows when any are marked, otherwise on the selected row
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "actions target marked rows"`
- AC-4: Rows that cannot take the action (processing or orphan reviews for approve, invalid or approved specs) are left out of a batch and reported, never attempted
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "ineligible rows are skipped"`
- AC-5: A Skip or Reject batch needs one second press for the whole batch, labelled with the row count
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "batch needs one confirm"`
- AC-6: An Approve batch runs one row at a time, and each review row still goes through `agent-review approve` and its dialog
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "approve batch is sequential"`
- AC-7: After a batch each row keeps its own result message, one summary toast is shown, the list refreshes, and marks on rows that vanished are dropped
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "batch reports per row"`
- AC-8: Existing plugin tests still pass
  verify: `claude plugin test session-band-plugin`
  baseline: pass
- AC-9: The plugin validates
  verify: `claude plugin validate session-band-plugin`
  baseline: pass
- AC-10: The Gates key labels and markers read clearly in the live band
  verify: manual - visual judgement in a live session

## Boundaries
### Always
- Keep target selection, marking and batch eligibility in pure functions in `gates.ts`
- Run `~/dotfiles/scripts/ac-run check specs/gates-bulk-actions.md` and `~/dotfiles/scripts/floor-guard` before claiming done
- Work in the `gates-bulk` worktree, commit as you go, push the branch, open a draft PR
### Ask first
- Changing any existing hotkey
- Approving several reviews behind a single dialog
### Never
- Edit `scripts/agent-review`, `scripts/ac-run` or `pi/.pi/agent/extensions/agent-review/`
- Run `ac-run approve` or `agent-review approve` yourself
- Edit a `verify:` line or a test to make a check pass
- Merge the PR

## Open Questions
None. All three were resolved on 2026-10-21; see Assumptions.

## Assumptions
Resolved with the user on 2026-10-21.
- Hotkeys: `m` toggles a mark on the selected row; `v` marks every row, or clears all marks when every row is already marked. `M` cannot work: the engine lowercases `Button` hotkeys on keydown, so Shift+m is `m`. Both `m` and `v` are unbound in the Gates pane today, so no existing hotkey changes.
- Approve batches have no cap; each review row shows its own `agent-review approve` dialog.
- Spec rows and review rows can be marked together in one batch; each row runs its own command.
- Eligibility (AC-4): Approve leaves out processing and orphan reviews and invalid or approved specs. Reject leaves out invalid specs only, because `ac-run reject` on an approved spec revokes its approval, which is a valid action. Skip takes every review row.
- A single-row action keeps today's per-row toast, and a single review whose approval reports a changed tree still opens the review in Neovim. In a batch of more than one row, that outcome is recorded as the row's message and Neovim is not opened.
- The existing pane test that asserts a non-orphan review reject sends `AgentReviewRejectAll` to Neovim is updated to assert `agent-review skip`, because AC-1 removes that behaviour on purpose. No other existing test changes.
