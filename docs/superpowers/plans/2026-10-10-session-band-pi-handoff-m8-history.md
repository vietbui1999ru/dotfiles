# session-band Pi hand-off, M8: review-integration fixes and a colored history pane

Date: 2026-10-10. Audience: Pi, building cold. Addendum to `docs/superpowers/plans/2026-10-10-session-band-pi-handoff.md` and `...-m7-monitor.md`. **Read both first**: their facts, decisions and traps still apply. This builds on the code on branch `feat/session-band-pi-handoff` (or `main` once merged). Read that code before editing it; where a name differs from the plans, the code wins.

## Dispatch order

1. **Part A and the M7 plan's M7a together, in one dispatch** (they all touch `hooks/pane.tsx` and `hooks/review.ts`; separate dispatches would conflict).
2. **Part B** (the history pane) after the human has confirmed M7a works live.
3. Claude builds the gate side separately (`agent-review approve`, `:AgentReviewRejectAll`, extension fixes). **Do not touch** `scripts/agent-review`, `nvim/.config/nvim/lua/custom/agent_review.lua`, `scripts/agent-review-nvim-test.lua`, `pi/.pi/agent/extensions/agent-review/`, `claude/.claude/rules/`, `claude/.claude/settings.json`, `shared/`. Stub their contract in tests.

## Part A: fixes to the review integration (from an independent review of the gate)

Evidence is from `hooks/review.ts`, `hooks/pane.tsx` and `hooks/register.tsx` on the M1 to M5 branch, checked against the real gate (`pi/.pi/agent/extensions/agent-review/index.ts`, `nvim/.config/nvim/lua/custom/agent_review.lua`). Each is its own commit with a test.

- **A1, wrong decision shape** (`review.ts:25`). It tests `file.accepted === true` and `!decision.notes`. The real shape is `files: [{file, status: "accepted" | "changed"}]`, `notes: []` (an empty array is truthy), `patch: string`, optional `skipped: true`. So the band can never show `approved`. A decision is approved only when every file has `status === "accepted"`, `notes` is an empty array, `patch.trim() === ""` and `skipped` is absent; anything else is `changes requested`. Fix the invented fixtures in `handoff.test.ts` (about lines 48-49) to the real shape.
- **A2, state is not keyed by run** (`register.tsx:92-98`, `review.ts:32`). It folds in every decision ever written in the repo; decisions are never deleted. Read only `decisions/<runId>.json` for the task's own run id. A `pending/<runId>.processing` file counts as pending (a claim in progress). When a decision exists but the pending record is still there, the state is `decided, waiting for the next Pi run in this repo`, not `approved`: a print-mode Pi has exited and only a later Pi session consumes the decision.
- **A3, approve call** (`pane.tsx:120-129`). Run `[<HOME>/dotfiles/scripts/agent-review, "approve", runId]` by **absolute path** (the command is not on PATH), with `{ cwd: await reviewRoot($, task.cwd), timeoutMs: 60000 }` (the command shows a confirmation dialog that waits for a click; the default 30 s timeout would cut it off). The command prints exactly one JSON line `{ok, reason?, message?}`; ignore stderr and exit code except to map a failed spawn to "gate not available".
- **A4, socket matching** (`pane.tsx:73-74`). `matchingSocket` also matches when the repo is inside the Neovim's cwd, so a Neovim opened in `~` matches every repo. Match only when the socket's cwd equals the repo root or is inside it. Drop the `repo.startsWith(socket.cwd + '/')` branch.
- **A5, which pending record** (`pane.tsx:62-71`). `pendingFor` takes the first `*.json`. Pick the record whose `runId` belongs to the task (the band remembers the run id when it first sees the pending file for a tracked task); fall back to the oldest by `startedAt`. Skip records that carry an `error` field.
- **A6, Reject all** (`pane.tsx:105-106`). Append the run id: `:AgentReviewRejectAll <runId>`. After launching Neovim through `herdr`, wait for the socket file to exist (poll `$.fs.exists` up to 3 s, every 100 ms) before `--remote-send`. Check the `--remote-send` exit code and toast a failure when non-zero.
- **A7, exit 1 is not a failure when a review is pending.** A `pi -p` run that leaves a review for the person exits 1 by design, so pueue marks it `Failed(1)`. Show a `Failed` task whose repo has a pending record for it as `review pending` (yellow), not as a failure (red). A real failure with no pending record stays red and persists until dismissed.

## Part B: the history pane (new, build only after M7a is confirmed live)

### Goal
A pane that lists **completed** Pi hand-off tasks from `pueue`, newest first, color-coded so the outcome reads at a glance. Today a finished task disappears from the band after 30 s and the `/pi` pane lists only tasks this session dispatched.

### Decisions (do not reopen)
1. **Own pane**, id `pi-history`, command `/pi-history`, also reachable from a `[history]` Button in the `/pi` pane. It does not change the band.
2. **Which tasks:** every finished pueue task on the machine whose command is a Pi dispatch (`isPiDispatch` from `hooks/pueue.ts`), tracked by this session or not. States `Done` (any result), `Failed`, `Killed`. **Read-only: no control of any kind** (no abort, remove, continue, dismiss).
3. **Colors** (palette from `hooks/palette.ts`; add nothing new): `Done` + `Success` green `✓`; `Failed` with exit 1 where the repo had a pending review for it yellow `✓ review` (Part A7); other `Failed` red `✗ exit <n>`; `Killed` mauve `✗ killed`; muted for metadata. A one-line **legend** at the top of the pane states these four meanings so the colors are explicit.
4. **Row content, in order:** glyph and result, `#<id>`, label (the slug), `model:effort`, duration, finished-at relative (`3m ago`, `yesterday`), repo or worktree basename, tokens and cost, review outcome when known (`approved`, `changes requested`, `pending`). Wide rows drop, in order: repo, tokens and cost, model:effort. Never drop glyph, id, label, finished-at.
5. **Window and cap:** last 7 days, at most 50 rows, with a `[show older]` Button adding the next 50. Result filter Buttons `all / done / failed / killed`.
6. **Detail:** selecting a row (a Button per row, key `pi-hist-<id>`; reuse the selection pattern from M7a) shows below it: start and end times, exit result, working directory, the dispatch's model and effort, the label, the command truncated to 120 characters **with no `envs` ever shown**, and **Pi's final assistant message** (the last assistant `text` block of its session file, up to 20 lines).
7. **Usage:** for a task whose command carries `--session-id pueue-<slug>`, resolve its session file from the task's `path` (cwd) as in the base plan and sum `usage` tokens and cost. Read the file in 1 MiB chunks with `tail -c +<offset>` through `$.process.run`, **lazily for the visible rows and the selected row only**, cache the result in state keyed by file size and mtime, and show `…` while loading. A task without `--session-id` shows `n/a`.
8. **Cadence:** `pueue status --json` when the pane opens and every 10 s **only while the pane is open**; no timer when it is closed. Session files are read once per row and re-read only if their size changed.
9. **Privacy:** never display `envs`; show the label, else the first 48 characters of `command`; never log a full command. Final messages come from the person's own machine but are shown only in the detail view on selection.
10. **Relation to M7b:** the history pane subsumes M7b's "finished in the last hour" rows. When this lands, M7b keeps only live (Running, Queued, Paused) other tasks.

### Work
Under `session-band-plugin/`, commit as you go, tests next to each file, plain `.ts` for logic and `.tsx` for `$` calls. (1) `hooks/history.ts` pure: `historyRows(tasks, reviews, usage, nowMs, filter)`, `resultStyle(task, hadPendingReview)`, `relativeTime(ms, nowMs)`, `finalMessage(jsonlTail)`; table-driven tests including a Failed(1) with a pending review, a real failure, Killed, no `--session-id`, and the 7-day and 50-row caps. (2) `hooks/history.tsx` pane and `/pi-history` command, filter and show-older Buttons, selection and detail, lazy usage. (3) a `[history]` Button in the `/pi` pane. Tests: the legend renders; rows sort newest first; filters work; the pane opens with no tracked tasks; no timer or `pueue` call when closed.

### Out of scope (YAGNI), do not build
Re-running or continuing a task from here, deleting or cleaning from here, exporting, charts or sparklines, notifications, grouping parallel dispatches into families, and any display of Pi's internal subagents (there is no data source for them: only `pueue` tasks are listed).

### Acceptance
`claude plugin validate session-band-plugin` passes and `claude plugin test session-band-plugin` is green (record the starting count first). The pane shows no command that can modify anything. Colors match decision 3 in a live check.

### Verification
| Check | How | Expect |
|---|---|---|
| Tests, manifest | `claude plugin test`, `claude plugin validate session-band-plugin` | green |
| Live: colors | open `/pi-history` with a success, a real failure (`pueue add -i -- false`), a killed task and a task with a pending review | green, red with exit code, mauve, yellow `✓ review` |
| Live: detail | select a Pi task | final message, tokens and cost, no `envs` |
| Live: legacy | a Pi task without `--session-id` | row shown, usage `n/a` |
| Live: idle | close the pane | no further `pueue status` calls |

Live rows need a human; report them pending.

## Traps
- **A `Failed(1)` Pi run with a pending review is not a failure.** Resolve the pending record from the repo of the task's `path`.
- **A reused slug resumes an old session.** Two tasks can share a session file; show both rows, and sum usage once per file.
- **Do not `$.fs.read` a session file whole.** Use the chunked `tail -c +N` read.
- **pueue ids are global to the machine.** This pane never changes any of them.
- **rtk swallows exit codes.** Read command text, not status.
