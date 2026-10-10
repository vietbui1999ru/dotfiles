# session-band Pi hand-off, M7: live task monitor

Date: 2026-10-10. Audience: Pi, building cold. This is an addendum to `docs/superpowers/plans/2026-10-10-session-band-pi-handoff.md`. **Read that plan first**: its "Already established" facts, "Decisions (do not reopen)" and "Traps" all still apply, and the names below (`TrackedTask`, `PiProgress`, `summarize`, `hooks/handoff.ts`, `hooks/pane.tsx`) come from it. M7 builds on the code M1 to M5 produced, which lives on branch `feat/session-band-pi-handoff` (or `main` once merged). **Read that code before editing it; where a name differs from the base plan, the code wins.**

## Goal

An at-a-glance, live monitor in the `/pi` pane: one row per task showing what each Pi session is doing right now. Today the pane lists tasks and tails only the selected task's transcript, so you cannot see all of them at once.

## Staging: build M7a only unless this prompt says otherwise

- **M7a, tracked-task monitor** (this dispatch). Rows for the tasks this Claude session dispatched. The human confirms it works in a live gate before anything else is built.
- **M7b, read-only "other pueue tasks"** is specified below so the decision is recorded, but **do not build it** until a later prompt names M7b. If you finish M7a, stop.

## Already established, do not re-derive

- `PiProgress` (M1/M2) already carries tokens, cost, `lastActivity` (latest tool call), `files`, model and effort, and a byte `offset`. The one thing missing for a monitor is **when the last event happened**. Every Pi JSONL event has an ISO `timestamp`; the `message` events also carry `message.timestamp`. Add `lastEventMs` to `PiProgress` (parse the newest event's `timestamp`).
- The poll already runs every 2 s while a tracked task is live (decision 5). **The monitor rides that poll; add no timer.** When no tracked task is live, nothing runs.
- Elapsed time comes from the pueue task `start`; formatting helpers exist from M1 (`formatElapsed`, `formatTokens`).

## Decisions (do not reopen)

1. **Row content, in order:** state glyph (`▶` running, `◌` queued, `⏸` paused, `✓` done, `✗` failed), `#<id>`, `model:effort`, elapsed, current activity (the latest tool call as `edit <path>` or `bash <first 40 chars>`; for a task with no tool call yet, `thinking` if the last event was an assistant message, else `starting`), tokens and cost, then **idle age**: `idle <duration>` when the newest event is older than 30 s, yellow after 2 minutes, red after 5. A finished task shows no idle age.
2. **Order:** failed first (they need attention), then running, then queued and paused, then done by most recent end. Done rows stay for the lifecycle linger from decision 5 of the base plan and no longer.
3. **Width.** When the pane is narrow, drop in this order: cost, tokens, model:effort, then truncate activity with an ellipsis. Never drop glyph, id, elapsed or idle age.
4. **Row selection is new in M7a.** M4 has none: `selected()` in `hooks/pane.tsx` returns the first non-dismissed task, so with several tracked tasks the transcript and every per-task control (Abort, Remove, Approve, Reject all) act on the oldest one, not the one the person is looking at. Add a selected task id to state (`selectedId` in the `handoff` atom); each monitor row is a `Button` (key `pi-row-<id>`) that sets it; default selection is the newest running task, else the newest task; the selected row is visibly marked. The transcript and **all** controls act on the selected task only. Keyboard and click both work via the `Button` focus ring.
5. **A task with no `--session-id`** (legacy) still shows a row: state, id, elapsed, label; activity and usage read `n/a`.
6. **Nothing here adds a control.** The existing per-task buttons (Abort, Pause/Resume, Remove, Dismiss, Continue) stay where M4 put them, acting on the selected row.
7. **House rules and ownership as in the base plan:** plain `.ts` for logic, `.tsx` for `$` calls, tests next to each file, commit by path. You do not touch the gate or policy files listed in the base plan's ownership section.

## Fixes from the review of M1 to M5 (do these first, one commit each)

Claude reviewed Pi's M1 to M5 build (branch `feat/session-band-pi-handoff`) on 2026-10-10: 107 tests pass, no forbidden files touched, no decision files written by the mod. These gaps remain. Line numbers are from that branch's `hooks/pane.tsx`; the code wins if they have moved.

- **F1, no task selection** (`pane.tsx:16`): fixed by decision 4 above.
- **F2, Continue silently changes model** (`pane.tsx:46`): the model comes from a `--model` regex on the stored command and falls back to `opencode-go/deepseek-v4-flash:off` when the task record or flag is missing. That breaks "same model:effort" and "no silent defaults". Take the model from `PiProgress` (the `model_change` and `thinking_level_change` events) first, the command second; if neither is known, do nothing and toast `Cannot continue: model unknown`. Test: unknown model sends nothing.
- **F3, Clean stale deletes from a stale dry run** (`pane.tsx:139-147`): the second press runs the stored selection with no re-check and no expiry, so a session resumed with Continue after the dry run (fresh mtime) would still be removed. Store the dry run's time; expire it after 60 s; on the confirming press recompute `selectStale` and delete only items present in both lists; if they differ, toast and require a new dry run. Test: a file whose mtime became fresh between presses is not deleted.
- **F4, misleading Reject toast** (`pane.tsx:134-135`): `Rejecting review <id>.` is shown even when the Neovim command is missing or fails (`:AgentReviewRejectAll` does not exist until M6). Check the `nvim --remote-send` exit code, toast a failure when non-zero, and otherwise say `Sent Reject all to Neovim; the decision appears in the band when recorded.` Test both.
- **F5, minor** (`pane.tsx:13`): `continueCount` is module state that resets on reload, so a Continue file name can be reused before pueue has read the old one. Use `Date.now()` in the file name instead. Add a test for two quick Continues producing different paths.

## Work: M7a

Under `session-band-plugin/`. Commit as you go. The fixes above come first. The starting test count is 107 (M1 to M5 on `feat/session-band-pi-handoff`); keep it green.

1. **`hooks/pisession.ts`:** add `lastEventMs` to `PiProgress` and set it in `fold` from the newest event's `timestamp`. Test: a chunk with three events sets it to the latest; an unparseable timestamp leaves it unchanged; an empty chunk leaves it unchanged. Add `lastEventMs` to the exported type in `types/index.d.ts`.
2. **`hooks/handoff.ts`:** `monitorRows(tracked, progress, tasks, nowMs)` returning ordered row models per decisions 1, 2 and 5, with `activityLabel(progress)` and `idleAge(progress, task, nowMs)` as pure helpers. Table-driven tests: each state, ordering, the idle thresholds at 29/31 s, 119/121 s and 299/301 s, a legacy task, a task that has not emitted a tool call.
3. **`hooks/pane.tsx`:** render the rows as a "Monitor" section above the transcript with width-based dropping (decision 3) and row selection (decision 4). Tests: the section appears only when at least one tracked task exists; selecting a row changes the transcript's task; narrow width drops fields in the stated order.
4. **No new timer, no new `pueue` call.** A test must assert that with no live tracked task the poller is not running.

## Acceptance criteria

- `claude plugin validate session-band-plugin` passes; `claude plugin test session-band-plugin` is green with new tests (record the starting count first).
- Rows update at most 2 s after Pi's session file changes.
- The idle age rises while Pi thinks without writing events, and resets on the next event.
- With zero tracked tasks the pane looks as it did before M7.

## Verification

| Check | How | Expect |
|---|---|---|
| Tests and manifest | `claude plugin test` and `claude plugin validate session-band-plugin` | green |
| Live: two tasks | dispatch two Pi tasks with `--session-id pueue-<slug>`; open `/pi` | two rows, each with its own current activity, updating |
| Live: idle | a task in a long thinking step | `idle` appears after 30 s, turns yellow at 2 min |
| Live: failure | `pueue add -i -- false` through Claude | a failed row sorts first and stays until dismissed |
| Live: legacy | a task with no `--session-id` | row shows state and elapsed, activity `n/a` |

Live rows need a human in an interactive terminal; report them pending, do not claim them.

## M7b (specified, not to be built yet)

Recorded so the decision survives. Build only when a later prompt says M7b, after the human confirms M7a works.

- A collapsed section "Other pueue tasks (N)" in the pane, **read-only**: tasks on this machine that are not tracked by this session (started from a shell or another Claude session).
- **No controls on these rows**, ever in M7b: no abort, pause, remove, dismiss, continue, and no "adopt into tracking". The band is unaffected; it shows tracked tasks only.
- Cadence: one extra `pueue status --json` every 5 s, **only while the pane is open and the section is expanded**; nothing otherwise.
- Show Running, Queued and Paused tasks, plus finished tasks from the last hour, capped at 20 rows.
- **Privacy:** show the task's `label` if set, otherwise the first 48 characters of `command`. Never show `envs`. A command can carry tokens in its arguments, so truncate before display and never log the full command.
- For a Pi dispatch carrying `--session-id pueue-<slug>`, resolve its session file from the task's `path` (cwd) as the base plan describes, and show activity and usage as in M7a. Otherwise state and elapsed only. Read-only access to the session file.

## Out of scope (YAGNI), do not build

Adopting an untracked task, any control on untracked rows, notifications or sounds on stall, a history view, per-model cost charts, and any change to the band.

## Traps

- **`pueue` ids are global to the machine.** Tracked rows come from tracked ids only. M7b rows are display-only and must be visually distinct from tracked rows.
- **Idle is not failure.** A long reasoning step produces no events; show age, do not mark the task failed.
- **Do not `$.fs.read` a session file whole.** Use the offset tail from the base plan.
- **rtk swallows exit codes.** Read command text, not status.
