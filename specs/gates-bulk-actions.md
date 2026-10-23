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
- Which hotkeys for mark and mark-all? Default: `m` toggles, `M` marks all or clears; confirm the `Button` hotkey accepts them.
- Does Approve-all need a cap? Default: no cap; each review shows its own dialog anyway.
- Should spec rows and review rows be markable together in one batch? Default: yes; each row uses its own command.
