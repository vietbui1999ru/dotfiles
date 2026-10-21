# Pi plan: bulk Approve, Skip and Reject in the Gates pane

Spec: `specs/gates-bulk-actions.md` (read it first; work only toward its AC ids and obey its Boundaries and Assumptions).
Worktree: `/Users/vietquocbui/dotfiles/.claude/worktrees/gates-bulk`, branch `gates-bulk`. Work only here.

## Files
- `session-band-plugin/hooks/gates.ts`: pure functions (target selection, marking, eligibility, summary).
- `session-band-plugin/hooks/gates.test.ts`: unit tests for the pure functions.
- `session-band-plugin/hooks/gates.tsx`: state, runners, buttons, row rendering.
- `session-band-plugin/hooks/gates-pane.test.ts`: engine tests for pane behaviour, plus one assertion update (step 4).

Reuse, do not duplicate: `skipArgv`, `acRunArgv`, `approveTimeoutMs` (gates.ts); `approveArgv`, `approvalAction`, `needsRejectConfirm` (pane.tsx). Do not edit `pane.tsx`.

## Step 1: pure functions in gates.ts
Add, exported:
- `type GateAction = 'approve' | 'reject'`. On a review row `reject` means Skip; on a spec row it means Reject.
- `rowAction(row: GateRow): 'Skip' | 'Reject'`: `'Skip'` for review rows, `'Reject'` for spec rows.
- `ineligibleReason(action: GateAction, row: GateRow): string | undefined`:
  - approve: review `processing` -> `'processing'`, review `orphan` -> `'orphan'`, spec `invalid` -> `'invalid'`, spec `approved` -> `'approved'`.
  - reject: spec `invalid` -> `'invalid'`. Reviews are always eligible. Approved specs are eligible (reject revokes approval).
- `toggleMark(marked: readonly string[], key: string): string[]`.
- `markAll(marked: readonly string[], rows: readonly GateRow[]): string[]`: every row key, or `[]` when every row is already marked.
- `pruneMarks(marked: readonly string[], rows: readonly GateRow[]): string[]`: drops keys with no row.
- `batchTargets(rows: readonly GateRow[], marked: readonly string[], selected: string | undefined): GateRow[]`: the marked rows in `rows` order when any are marked, otherwise the selected row (or `[]`).
- `partitionBatch(action, rows)` -> `{ run: GateRow[]; left: { row: GateRow; reason: string }[] }` using `ineligibleReason`.
- `batchSummary(verb: string, results: readonly { ok: boolean }[], left: readonly { reason: string }[]): string`, for example `Skipped 3, 1 failed; left out 2 (processing, orphan)`. Leave out the parts that are zero.

Unit tests in `gates.test.ts`. Test names must contain these exact phrases, because the spec's `verify:` lines grep for them:
- `review row offers skip` (rowAction, and the pane test in step 3)
- `rows can be marked and cleared` (toggleMark, markAll, pruneMarks)
- `actions target marked rows` (batchTargets)
- `ineligible rows are skipped` (ineligibleReason, partitionBatch)

Commit: `feat(session-band): pure batch helpers for the Gates pane`.

## Step 2: gates.tsx
State:
- `GatesState` gains `marked: string[]`; the initial value is `[]`.
- `refresh` sets `marked: pruneMarks(state.marked, rows)`.

Per-row runners return `{ ok: boolean; message: string }` and do not toast:
- `approveOne($, row)`: keeps today's busy claim, the spec path (`show`, count `runs:`, `approveTimeoutMs`), and the review path. Change `approveReview` to return its outcome (`approved`, `open-review` with message, refused message, unavailable) instead of toasting.
- `skipOne($, row: ReviewRow)`: always `skipArgv(home, runId)` with `cwd: await $.session.cwd()`, for orphan and non-orphan rows alike. Parse `message` from stdout JSON as the orphan path does today; fallback `'Skipped.'` on exit 0, `'Could not skip review.'` otherwise.
- `rejectSpec($, row: SpecRow)`: today's `acRunArgv(home, 'reject', row.path)` with `cwd: row.worktree`, last line of stdout or stderr.
- Remove the `socketFor` + `reviewRemoteArgv(socket, 'AgentReviewRejectAll', ...)` reject branch. Remove `rejectToast` from the gates.tsx import (pane.tsx keeps it). Keep `socketFor`, `edit` and `openReview`; they are still used.

Actions:
- `approve($)`: read state, `batchTargets`, `partitionBatch('approve', ...)`. Run eligible rows one at a time with `for ... of` and `await` (never `Promise.all`), storing each row's message in `last[row.key]` as soon as it finishes. Then exactly one toast: for a single target, its own message (keep today's texts: `'Review approved.'`, `'Review gate not available.'`, refusal message), and if that single review's outcome is `open-review`, call `openReview` with the message as today. For more than one target, `batchSummary('Approved', ...)`, and do not open Neovim for `open-review` outcomes; record the message only. If every target is ineligible, do nothing (a single ineligible row stays a silent no-op, as today). Then `refresh`.
- `reject($)`: targets and `partitionBatch('reject', ...)`. Confirm key: `batch:` plus the sorted keys of the eligible rows. If `needsRejectConfirm(state.confirm, key)`, set `confirm` and toast `Press Skip again to confirm.` (or `Reject`, or `Skip/Reject` for a mixed batch) with ` (N rows)` appended when N > 1, then return. On the second press clear `confirm`, run the rows one at a time (review -> `skipOne`, spec -> `rejectSpec`), store each `last[row.key]`, show one toast (a single row's own message, or `batchSummary` for more than one), then `refresh`. Skip busy rows.

Buttons (keep every existing key and hotkey; add two):
- `gates-mark`, hotkey `m`, label `mark` (or `unmark` when the selected row is marked); toggles the selected row.
- `gates-mark-all`, hotkey `v`, label `all` (or `clear` when every row is marked).
- `gates-approve` label: `Approve`, or `Approve N` when N rows are marked. Dimmed when no target is eligible.
- `gates-reject` label: `rowAction(pick)` with no marks; `Skip N`, `Reject N` or `Skip/Reject N` with marks; ` again?` appended while the confirm for the current targets is pending.

Rows:
- Prefix is two characters: `›` or space for selection, then `*` or space for the mark. With nothing marked the output must stay byte-identical to today (`› SPEC.md  draft`, `  review run-1234  build  [landed]`).
- Review rows also show `state.last[row.key]` after the tags, the way spec rows show their note.

Commit: `feat(session-band): mark rows and batch gate actions`.

## Step 3: pane tests in gates-pane.test.ts
Reuse the existing `setup` and `review` helpers. Add tests whose names contain:
- `review row offers skip`: a non-orphan review row; `x` label is `Skip`; two presses run `agent-review skip run-...` with cwd `/r/w`; no `nvim` call with `AgentReviewRejectAll`. A spec row's label stays `Reject`.
- `batch needs one confirm`: mark two review rows; the first `x` press runs nothing; the second runs both skips; label contains `again?` between presses.
- `approve batch is sequential`: mark a spec row and a review row with the approve call held (as `gates second approve while one runs starts no second process` does); only one approve process has started before release; both run in order after it; the review uses `agent-review approve`.
- `batch reports per row`: after a two-row batch each row shows its own message, one toast is shown (collect `ui.toast` calls), the list refreshes (a second `list` call), and a mark on a row that disappears after refresh is gone (`marked` pruned).
- Also cover `rows can be marked and cleared` and `ineligible rows are skipped` at pane level (mark an orphan with a normal review, press approve: only the normal review runs and the orphan's reason is in the summary).

Commit: `test(session-band): pane tests for gates batch actions`.

## Step 4: the one existing-test update
In `gates-pane.test.ts`, the test `gates tree-changed approval opens owner review and normal reject sends Neovim RejectAll` asserts `<C-\\><C-N>:AgentReviewRejectAll run-12345678<CR>`. AC-1 removes that behaviour on purpose (see the spec's Assumptions). Rename the test to `gates tree-changed approval opens owner review and normal reject runs skip` and replace only that final assertion with one that a call `['/h/dotfiles/scripts/agent-review', 'skip', 'run-12345678']` was made. Change no other existing test.

Commit: `test(session-band): reject on an owned review now skips`.

## Checks before you stop
Run in the worktree and paste the output in your last message:
- `claude plugin test session-band-plugin` (all tests pass; baseline was 345 passing)
- `rg -n "review row offers skip|rows can be marked and cleared|actions target marked rows|ineligible rows are skipped|batch needs one confirm|approve batch is sequential|batch reports per row" session-band-plugin/hooks`

`claude plugin validate session-band-plugin` already fails on main with three errors in the generated `types` contract, unrelated to this work. Do not try to fix it.

## Boundaries
- Never edit `scripts/agent-review`, `scripts/ac-run`, `pi/.pi/agent/extensions/agent-review/`, `pane.tsx`, or the spec.
- Never run `ac-run approve` or `agent-review approve`.
- Never edit a `verify:` line, and change no existing test other than the step 4 assertion.
- Commit each step by path with the message given. Do not push, merge or rebase.
