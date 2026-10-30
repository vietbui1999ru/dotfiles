# Honest Pi run outcomes, with automatic checks

Status: design, awaiting approval. Date: 2026-10-29. Follow-up design (separate): the Pi pane grid layout.

## Why

The person dispatches several Pi runs and mostly glances at the `/pi` Monitor to see which ones finished, typing into one now and then. The Monitor shows pueue's state, and pueue's pass/fail is wrong in both directions:

- A plain dispatch (`pi -p`) that finished and left changes ends with exit code 1, so pueue says **Failed**. The `agent-review` Pi extension does this on purpose (`reportPrintFailure`, `pi/.pi/agent/extensions/agent-review/index.ts`) so an unattended run never looks accepted. Example: task 176 changed 7 files and showed "Failed".
- A `--tui` run never takes that path. It ends **Success** whenever Pi is quit, whether or not its changes pass anything.

So the person cannot tell which runs actually did the job, which ones crashed, and which ones hang. They want a run to count as **done and good** only when Pi finished **and** `verify-spec`'s checks pass. When the checks fail, they want the failures typed back into that Pi automatically, so it keeps working without being asked.

## Goals

1. Every Monitor row shows one honest outcome, derived from the run's real state, not from pueue's exit code.
2. When a run finishes, its spec checks run automatically in the background, and the result is saved.
3. When the checks fail, the failures go back into the same Pi automatically, up to 3 rounds per run.
4. One command, `pi-outcome <task id>`, prints the same outcome for Claude or a shell.

## Non-goals

- Pane layout or the grid (separate design).
- The workflow benchmark (separate session; see memory `workflow-benchmark-idea`).
- Changing how specs are approved, how reviews are approved, or how anything is merged.

## Anti-goals (a failure even if it works)

- Anything that approves a review, approves a spec, archives a spec, merges, or pushes on its own.
- A green row for a run whose checks passed on an older commit than the branch's current one.
- Endless automatic steering: a run that keeps failing must stop and wait for a person.
- A second copy of the outcome rules: the Monitor and `pi-outcome` must not disagree.

## Outcomes

Each run gets exactly one outcome, checked in this order:

| Outcome | When |
|---|---|
| queued | pueue has it queued |
| running | pueue running, and Pi has written to its session log recently |
| stuck | pueue running, Pi's agent status is `working`, and the session log has not changed for 10 minutes |
| killed | pueue says Killed |
| failed | Pi itself errored: pueue ended non-zero with an exit code other than the review-waiting code (below), or the session log ends in an error |
| checking | the run's check record has phase `checking` (`pi-checks` writes it before it starts) |
| fixing (n/3) | checks failed and failures were sent back to Pi; round n of 3 |
| checks failed | checks failed and no automatic round is left, or the run cannot take input (plain dispatch) |
| checks stale | a saved check result exists, but for an older commit than the worktree's current HEAD, and no new check is running |
| checks passed | the saved check result matches HEAD and every runnable check passed, plus floor-guard clean. This is "done and good" |
| finished, manual checks only | the approved spec has no runnable `verify:` lines |
| finished, no spec | Pi finished and the worktree has no approved `SPEC.md` for its branch, so pass/fail does not apply |

Independent of the outcome, a **review waiting** marker shows when the run has an `agent-review` pending record (`<root>/.pi/agent-review/pending/<runId>.json`, already read by the mod's Approve and Open review buttons).

"Pi finished" means: a plain dispatch exited, or a `--tui` run settled, meaning herdr reports `idle` or `done` for 15 seconds. That is the same signal `pi-view` already uses to move a pane to the `verdict` tab.

## Decisions

### 1. The review gate exits with a distinct code (Claude edits this, not Pi)

In print mode, `agent-review` exits **3** instead of 1 when a run is waiting for review. That keeps "done, review waiting" non-zero, so an unattended run still never looks accepted and pueue `--after` chains still stop. It is no longer confused with a crash. Update the extension's tests that assert exit code 1 for this case. `pi-view` must pass the code through unchanged. Pi must not edit the gate that reviews Pi, so Claude makes this change.

### 2. `ac-run check` saves its result (Claude edits this, not Pi)

`ac-run check` keeps printing what it prints now. With a new `--record <file>` option, it also writes the result to that file. `pi-checks` passes `~/.local/state/pi-checks/<session-id>.json`, so each dispatch has its own record, and a new dispatch into the same worktree starts fresh at round 0. The record holds: the worktree path, spec path and hash, branch, HEAD commit, a hash of `git diff HEAD` (the uncommitted state), the time, the phase (`checking` while running, `done` after), the automatic round count, and each AC's result (pass, fail, manual, pre-satisfied), with the last lines of output for failures. `floor-guard`'s result is saved next to it in the same record when it runs as part of the automatic check. `ac-run` is part of the spec gate, so Claude makes this change too.

### 3. Automatic checks when a run finishes

A new script, `scripts/pi-checks <worktree> <session-id>`, runs in the run's worktree when the run finishes. It runs `ac-run check SPEC.md` and `floor-guard`, then saves both results. It does nothing and records "no spec" when the worktree has no approved `SPEC.md` whose `branch:` matches. It never runs `verify-spec`'s fix loop or its archive step; those stay with Claude when it collects the run.

`pi-view` starts it:

- **Plain dispatch:** after Pi exits, before `pi-view` itself exits. The pueue task's exit code stays Pi's code (or the review gate's 3), not the checks' result.
- **`--tui` run:** in the wait loop that already detects the settle for the `verdict` move. It runs in the background, so the loop keeps watching the pane. When HEAD changes after a later settle (Pi made new commits, for example after a steer), it runs again. While one check is running, a second is not started.

### 4. Failures go back into Pi automatically

When the checks fail on a `--tui` run, `pi-checks` sends one message into that run's pane the same way the mod's Continue does: `herdr pane send-text <pane> <message>` followed by Enter. The pane id comes from `pi-view`'s `<session-id>.pane` file, and it stays the same after the pane moves to the `verdict` tab. `pi-steer` is not used: it writes to the input pipe that only plain dispatches create. Text sent while Pi is mid-turn arrives as a steer, as it does from Continue.

The message goes in as a **review batch** (decided 2026-10-30, after the first live run). While a run's review is pending, `agent-review` refuses plain input. It accepts only a review batch from the same Pi session, which it absorbs into a new run whose review covers all changes since the original base, so nothing is accepted on the way. So `pi-checks` first appends a `delivered` row `{id, agent: "pi:<session-id>", entryIds: [], state, queuedAt, deliveredAt}` to `<worktree>/.pi/agent-review/threads/queue.jsonl`, then sends the text with `[review-batch <id>]` as its first line. The mod's own batch delivery (`review-deliver.ts`) is not used: it waits while the session has a running pueue task, and a `--tui` run always has one. The message lists each failing AC id with its `verify:` line and the last lines of output, then any floor-guard findings. It ends with: fix these, commit, and stop.

- At most **3 automatic rounds per run**, counted in the saved record. After the third failed round, it sends nothing more. The row shows **checks failed**, and herdr shows a notification `pi#<task> checks failed, needs you`.
- A round counts only when HEAD changed since the previous check. A settle without new commits does not start a check, so it cannot spend a round.
- Plain dispatches have no live session to type into. Their failures are only shown (**checks failed**). Implementation dispatches use `--tui` by default, so this is the rare case.
- If the person types into Pi themselves, nothing special happens: the next settle with a new HEAD runs the checks again and the count continues.

### 4b. Edge cases settled

- **Exit codes.** Pi exits 0 when it ends normally. With decision 1, 3 means review waiting. Any other non-zero code is `failed`. For runs from before this change, exit 1 together with a pending record still reads as review waiting, as `isReviewResult` in `handoff.ts` does today.
- **`ac-run check` exit 3** (approval record missing): treated as `finished, no spec`, because the spec is not approved.
- **Spec with only manual checks** (no runnable `verify:` lines): `finished, manual checks only`, a muted state next to `finished, no spec`.
- **Staleness.** A result is current only when both HEAD and the uncommitted-state hash match. A change to either makes it `checks stale`.
- **After Pi quits.** When a `--tui` run's Pi exits and HEAD or the uncommitted state changed since the last check, `pi-view` runs `pi-checks` one last time before it exits, without steering, since nobody is left to steer. After that, `checks stale` can only come from changes made outside Pi, and it is final. `pi-outcome --check <task id>` runs `pi-checks` by hand.
- **Outside herdr** (no pane): there is no agent status, so `stuck` uses log silence alone, and there is no automatic steering.

### 5. One place for the outcome rules

The rules in the Outcomes table live in one pure function: inputs in, outcome out. Its inputs are the pueue state and exit code, the herdr agent status if there is a pane, the session log's last write time, the pending record, and the saved check record. Reading those inputs can be different code in the mod and in the command; the decision rules must not be. `scripts/pi-outcome <task id>` prints the outcome as one line, plus JSON with `--json`, and the `/pi` Monitor uses the same rules. Whether the mod imports the module or calls the command is the builder's choice. The mod already polls pueue and reads pending records, so a pure function that the mod imports is likely cheaper than starting a process per row.

### 6. What the Monitor shows

Each Monitor row shows the outcome instead of pueue's raw state, in the existing colours: green for checks passed, red for failed, checks failed and stuck, yellow for checking, fixing, checks stale and review waiting, muted for the rest. The existing idle timer stays. The `stuck` rule replaces its red tone for running tasks, so there is one signal, not two.

## Constraints

- The review gate (`agent-review` extension), `ac-run` and `floor-guard` are edited by Claude only (`plan-handoff.md`: Pi must not edit the gate that reviews Pi). The rest (`pi-checks`, `pi-view` changes, `pi-outcome`, Monitor rows) can go to Pi through a plan.
- Never run `ac-run approve` or `agent-review approve` automatically.
- Scripts follow the repo's conventions: zsh for `pi-view` and the shell helpers, Node `.mjs` with `node --test` tests next to them for logic, `claude plugin test .` for the session-band mod.
- Every rule in the Outcomes table gets a unit test that fixes its inputs: pueue state, exit code, pending record, saved check record, HEAD, and log age.

## Left to the builder

- The exact layout of the saved check record, within decision 2.
- How `pi-checks` is launched in the background from the `--tui` wait loop, and how it avoids two at once (a lock file is fine).
- How "the session log ends in an error" is detected from Pi's session JSONL.
- Wording of the steer message and the notification, within decision 4.

## Calls made by Claude, not the person

- 10 minutes of silence for **stuck**.
- Exit code 3 for review waiting.
- Check records kept per dispatch (session id) under `~/.local/state/pi-checks/`, written through a new `ac-run check --record` option.
- Automatic steering through `herdr pane send-text`, like the mod's Continue, not `pi-steer`.
- Plain dispatches and runs outside herdr get no automatic steering.
- A round counts only when HEAD changed.
- One last check, without steering, when a `--tui` Pi quits with unchecked changes. `checks stale` after that is final.
- Old runs with exit 1 plus a pending record still read as review waiting.
- One outcome per row, with review waiting as a separate marker.
