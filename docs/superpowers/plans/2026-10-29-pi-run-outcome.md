# Honest Pi Run Outcomes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Pi run shows one honest outcome in the `/pi` Monitor and in `pi-outcome`. The outcome comes from pueue, the review gate, Pi's log and an automatic spec check that runs when the run finishes, and failed checks are typed back into Pi up to 3 times.

**Architecture:** One pure TypeScript function (`deriveOutcome`) holds the outcome rules. The session-band mod imports it, and a Bun CLI (`scripts/pi-outcome`) imports the same file. A Node script (`scripts/pi-checks.mjs`) runs `ac-run check --record` and `floor-guard`, writes a per-dispatch record, and steers through herdr. `scripts/pi-view` starts it when a run finishes. The review gate gets a distinct exit code.

**Tech Stack:** TypeScript (session-band plugin, `claude plugin test .`), Bun (Pi extension tests, the `pi-outcome` CLI), Node `.mjs` with `node --test`, zsh (`pi-view`), Python (`ac-run`, tests in `scripts/tests/test_spec_loop.py`).

**Spec:** `docs/superpowers/specs/2026-10-29-pi-run-outcome-design.md`

## Global Constraints

- The review gate (`pi/.pi/agent/extensions/agent-review/`), `scripts/ac-run` and `scripts/floor-guard` are edited by Claude only. Tasks 1–2 are Claude's; tasks 3–7 may go to Pi.
- Never run `ac-run approve`, `agent-review approve`, archive a spec, merge or push automatically.
- Review waiting in print mode exits **3**. Pi's normal exit is 0. Any other non-zero code is `failed`. Exit 1 plus a pending record still means review waiting (old runs).
- Stuck: pueue running, herdr agent status `working` (or no pane), session log silent for **600 000 ms** (10 min).
- At most **3** automatic steer rounds per dispatch. A round counts only when the checked commit differs from the previous check's commit.
- Check records: `~/.local/state/pi-checks/<session-id>.json`, one per dispatch. Lock: `~/.local/state/pi-checks/<session-id>.lock` (a directory, made with `mkdir`).
- Settle signal: herdr `agent_status` `idle` or `done` for 15 s while the pane is unfocused, the same signal `pi-view` already uses for the verdict move.
- Steer path: `herdr pane send-text <pane> <message>`, then `herdr pane send-keys <pane> Enter`. Pane id from `$TMPDIR/pi-view/<session-id>.pane` (the `pane_file` in `pi-view`). Never `pi-steer`.
- Notification after the third failed round: `pi#<task> checks failed, needs you`.
- Commit through `$HOME/dotfiles/scripts/commit-funnel --worktree <worktree> -F <message file> <paths…>`.

## Review Focus

1. A `--tui` run that settles several times with no new commit must not start new checks or spend rounds. Covered by pi-checks test `skips when commit and diff are unchanged` (Task 4).
2. Two settles close together must not run two checks at once. Covered by pi-checks test `a held lock makes a second run exit without writing` (Task 4).
3. A pane that was closed (Pi quit) when the steer is due must not crash `pi-checks` or count a round. Covered by pi-checks test `no live pane: no steer, no round` (Task 4).
4. A worktree with no `SPEC.md`, a `SPEC.md` for another branch, or an unapproved one (`ac-run check` exit 3) must show `finished, no spec`, never `checks failed`. Covered by Task 4's `spec status` tests and Task 3's table tests.
5. Old pueue history (exit 1 plus pending record, from before Task 1) must not turn into `failed` in the Monitor. Covered by Task 3's `legacy exit 1 with pending review` test.

---

### Task 1: Review gate exits 3 for "review waiting" (Claude)

**Files:**
- Modify: `pi/.pi/agent/extensions/agent-review/index.ts:178-182` (`reportPrintFailure`)
- Test: `pi/.pi/agent/extensions/agent-review/agent-review.mode.test.ts:225-258`

**Interfaces:**
- Produces: a print-mode run that leaves a review, or is blocked by one, sets `process.exitCode = 3`. `pi-view` and Task 3 rely on 3.

- [ ] **Step 1:** In the two tests `a print run that leaves a review exits non-zero` and `a print run blocked by a pending review exits non-zero`, change `assert.equal(code, 1, …)` to `assert.equal(code, 3, …)`.
- [ ] **Step 2:** Run `cd pi/.pi/agent/extensions/agent-review && bun test agent-review.mode.test.ts`. Expected: those two tests FAIL (got 1).
- [ ] **Step 3:** Name the code as `export const REVIEW_WAITING_EXIT = 3` and set it in `reportPrintFailure`. Keep the stderr message unchanged.
- [ ] **Step 4:** Run `bun test` in that directory. Expected: all tests pass, including `an interactive run leaves the exit code alone`.
- [ ] **Step 5:** Commit: `fix(agent-review): exit 3 when a print run is waiting for review`.

### Task 2: `ac-run check --record <file>` (Claude)

**Files:**
- Modify: `scripts/ac-run` (`cmd_check` at line 356, the `check` subparser near line 406)
- Test: `scripts/tests/test_spec_loop.py`

**Interfaces:**
- Produces: `ac-run check [--record FILE] SPEC_PATH`. Output and exit codes are unchanged (0 pass, 1 fail, 3 no approval record). With `--record`, it also writes this JSON to FILE, including on exit 1:
  `{"spec": <rel path>, "specHash": <spec_hash(spec)>, "branch": <spec branch>, "exit": <int>, "acs": {"AC-n": {"result": "pass"|"fail"|"manual"|"pre-satisfied", "tail": <last output lines, fail only>}}}`
  On exit 3, it writes `{"spec": …, "exit": 3, "acs": {}}`.

- [ ] **Step 1:** Add tests `test_check_record_written_on_pass`, `test_check_record_written_on_fail` (asserts `acs["AC-1"]["result"] == "fail"` and a non-empty `tail`) and `test_check_record_without_approval` (asserts `exit == 3`). Reuse the file's existing approved-spec fixture helpers.
- [ ] **Step 2:** Run `python3 scripts/tests/test_spec_loop.py`. Expected: the three new tests FAIL.
- [ ] **Step 3:** Implement. Gather the rows `cmd_check` already builds into the record. Write it with `write_text(json.dumps(rec, indent=2) + "\n")` after creating the parent directory.
- [ ] **Step 4:** Run the test file again. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(ac-run): save the check result with --record`.

### Task 3: `deriveOutcome`, the single set of outcome rules

**Files:**
- Create: `session-band-plugin/hooks/outcome.ts`
- Test: `session-band-plugin/hooks/outcome.test.ts`

**Interfaces:**
- Produces:
```ts
export type CheckRecord = {
  phase: 'checking' | 'done'
  commit: string
  diffHash: string
  specStatus: 'approved' | 'none' | 'manual-only'
  passed?: boolean
  round: number
  steered: boolean
}
export type OutcomeInputs = {
  pueue: { state: 'Queued' | 'Running' | 'Paused' | 'Done' | 'Failed' | 'Killed' | 'Other'; exit?: number }
  agentStatus?: string          // herdr agent_status; undefined when there is no pane
  logAgeMs?: number             // now minus the session log's last write
  reviewPending: boolean
  check?: CheckRecord
  head?: { commit: string; diffHash: string }
}
export type Outcome = 'queued' | 'running' | 'stuck' | 'killed' | 'failed' | 'checking' | 'fixing'
  | 'checks failed' | 'checks stale' | 'checks passed' | 'finished, manual checks only' | 'finished, no spec' | 'finished'
export const STUCK_MS = 600_000
export const deriveOutcome = (input: OutcomeInputs): {
  outcome: Outcome; round?: number; tone: 'green' | 'red' | 'yellow' | 'muted'; reviewWaiting: boolean }
```
- Rules, first match wins:
  1. Queued or Paused → `queued`. Killed → `killed`.
  2. Failed, unless exit is 3 or (exit is 1 and `reviewPending`) → `failed`.
  3. `check.phase === 'checking'` → `checking`.
  4. `check` is current (commit and diffHash equal `head`):
     - `specStatus` none → `finished, no spec`; manual-only → `finished, manual checks only`
     - passed → `checks passed`
     - not passed and `steered` → `fixing` with `round`
     - otherwise → `checks failed`
  5. pueue Running → `stuck` when `logAgeMs >= STUCK_MS` and `agentStatus` is `working` or undefined; otherwise `running`.
  6. `check` exists but is not current → `checks stale`.
  7. No `check` → `finished` (no record yet; muted).
- Tones: green for `checks passed`; red for `failed`, `checks failed` and `stuck`; yellow for `checking`, `fixing` and `checks stale`; muted otherwise. `reviewWaiting` equals `reviewPending`.
- `finished` is a plan-level addition to the spec's table: a run whose check record does not exist yet, for example from before this change.

- [ ] **Step 1:** Write one test per rule and tone, named after the outcome (`queued`, `killed`, `failed on exit 2`, `review-waiting exit 3 is not failed`, `legacy exit 1 with pending review is not failed`, `checking`, `checks passed`, `fixing carries the round`, `checks failed when not steered`, `no spec`, `manual checks only`, `stuck after 10 minutes working`, `idle Pi is not stuck`, `running outside herdr uses log age alone`, `checks stale after a new commit`, `checks stale after uncommitted change`, `finished without a record`). Each asserts `{ outcome, tone }` for fixed inputs.
- [ ] **Step 2:** Run `cd session-band-plugin && claude plugin test .`. Expected: the new tests FAIL (module missing).
- [ ] **Step 3:** Implement `deriveOutcome` as listed. No I/O in this file.
- [ ] **Step 4:** Run `claude plugin test .`. Expected: all pass (448 + new).
- [ ] **Step 5:** Commit: `feat(session-band): derive one honest outcome per Pi run`.

### Task 4: `scripts/pi-checks.mjs`, automatic checks and steering

**Files:**
- Create: `scripts/pi-checks.mjs` (executable, `#!/usr/bin/env node`)
- Test: `scripts/pi-checks.test.mjs`

**Interfaces:**
- Consumes: `ac-run check --record` (Task 2), the `CheckRecord` shape (Task 3).
- Produces: `pi-checks <worktree> <session-id> [--no-steer]`, exit 0 always. A run that hits an error writes nothing and prints the error to stderr. The record file is `CheckRecord` plus `worktree`, `spec`, `branch`, `time` (ISO), `acs` (from Task 2), and `floorGuard: { passed: boolean, output: string }`.
- Overridable for tests: `AC_RUN_BIN`, `FLOOR_GUARD_BIN`, `HERDR_BIN_PATH`, `PI_CHECKS_STATE` (state directory), `PI_VIEW_RUN_DIR` (where `<session-id>.pane` lives; default `$TMPDIR/pi-view`).
- Flow:
  1. Take the lock (`mkdir`). If it already exists, exit.
  2. Compute `commit` (`git rev-parse HEAD`) and `diffHash` (sha1 of `git diff HEAD`).
  3. If the saved record is `done` with the same commit and diffHash, release the lock and exit.
  4. Write the record with phase `checking`.
  5. Find `SPEC.md` at the worktree root. If there isn't one, or its `branch:` is not the current branch, set specStatus `none`.
  6. Otherwise, run `ac-run check --record <tmp> SPEC.md`. Exit 3 means `none`. All ACs `manual` means `manual-only`. Otherwise `approved`.
  7. For `approved`, run `floor-guard` in the worktree. Set `passed` = ac-run exit 0 and floor-guard exit 0.
  8. If not passed and the commit differs from the previous record's commit: round = previous round + 1. Otherwise round stays the same.
  9. If not passed, `--no-steer` is absent, the pane file names a live pane (`herdr pane get` succeeds) and round ≤ 3: send the steer and set `steered: true`. Otherwise set `steered: false`. If round ≥ 3 and it did not steer, send the notification via `herdr notification show "pi#<PUEUE_TASK_ID> checks failed, needs you"`.
  10. Write the record with phase `done`. Release the lock.
- Steer message: one line per failing AC (`AC-n failed: <verify line>` plus its `tail`), then the floor-guard output if it failed, then `Fix these, commit, and stop.`

- [ ] **Step 1:** Write tests with stub binaries on a temp git repo. Each stub is a small script that logs its argv and exits with a set code. Tests: `no SPEC.md records specStatus none and does not run ac-run`, `spec for another branch records none`, `ac-run exit 3 records none`, `all-manual spec records manual-only`, `passing checks record passed and send nothing`, `failing checks steer the live pane once and set round 1` (asserts `send-text` then `send-keys … Enter`), `skips when commit and diff are unchanged`, `a held lock makes a second run exit without writing`, `no live pane: no steer, no round`, `third failed round steers; fourth notifies and does not steer`, `--no-steer never steers`.
- [ ] **Step 2:** Run `node --test scripts/pi-checks.test.mjs`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement the flow above.
- [ ] **Step 4:** Run `node --test scripts/*.test.mjs`. Expected: all pass (56 + new).
- [ ] **Step 5:** Commit: `feat(scripts): run spec checks when a Pi run finishes and steer failures back`.

### Task 5: `pi-view` starts the checks

**Files:**
- Modify: `scripts/pi-view` (the `--tui` wait loop, lines ~256–305, and the plain-dispatch end, lines ~316–336)

**Interfaces:**
- Consumes: `scripts/pi-checks.mjs` (Task 4), invoked as `node ${script_dir}/pi-checks.mjs <PWD> <session_id> [--no-steer]`.

- [ ] **Step 1 (`--tui` settle):** in the wait loop, where `state` is idle or done and the pane is unfocused for ≥ 15 s, start `pi-checks` in the background (`&!`) on each settle. `pi-checks` itself skips unchanged commits and held locks, so the loop needs no new state. This is separate from the one-time verdict move; keep that logic as it is.
- [ ] **Step 2 (`--tui` exit):** after the loop ends (exit file read), run `pi-checks … --no-steer` in the foreground before `exit ${rc:-1}`. Keep `rc` unchanged.
- [ ] **Step 3 (plain dispatch):** after Pi exits and before `rm -f -- $pane_file`, run `pi-checks … --no-steer` in the foreground. Keep `rc` unchanged. Report the herdr state for `rc == 3` as `idle 'review waiting'`, not `blocked`.
- [ ] **Step 4:** Run `zsh -n scripts/pi-view`. Expected: no output. Run `node --test scripts/*.test.mjs` and `cd session-band-plugin && claude plugin test .`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(pi-view): run the spec checks when a Pi run settles or exits`.

### Task 6: The Monitor shows the outcome

**Files:**
- Modify: `session-band-plugin/hooks/handoff.ts` (`MonitorRow` at line 17, `monitorRows` at line 94, `idleAge` at line 87, `isReviewResult` at line 135)
- Modify: `session-band-plugin/hooks/pane.tsx` (where Monitor rows are drawn, around line 593)
- Test: `session-band-plugin/hooks/handoff.test.ts` (or the existing monitor-row test file)

**Interfaces:**
- Consumes: `deriveOutcome`, `CheckRecord` (Task 3).
- Produces: `MonitorRow` gains `outcome: Outcome`, `tone`, `round?: number` and `reviewWaiting: boolean`. `monitorRows` takes an extra argument, `outcomeInputs: Readonly<Record<number, Omit<OutcomeInputs, 'pueue'>>>`. The pane gathers those inputs per task: the check record by `item.sessionId`, HEAD and diffHash from the task's `cwd`, herdr status from the `<session-id>.pane` file, log age from `PiProgress.lastEventMs`, and `reviewPending` from the existing pending-record lookup.

- [ ] **Step 1:** Add tests: `a row shows checks passed in green`, `a row shows fixing 2/3`, `a review-waiting row keeps its marker`, `a stuck row replaces the red idle tone`, `exit 3 sorts with finished tasks, not failed ones`.
- [ ] **Step 2:** Run `claude plugin test .`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. The row text shows the outcome (`fixing 2/3` when there is a round) and `· review` when `reviewWaiting` is true. `idleAge` returns no red tone for a running task, because `stuck` carries it now. Exit 3 counts as a review result in `isReviewResult`, next to the legacy exit 1.
- [ ] **Step 4:** Run `claude plugin test .`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(session-band): show each Pi run's honest outcome in the Monitor`.

### Task 7: `scripts/pi-outcome` CLI

**Files:**
- Create: `scripts/pi-outcome` (executable, `#!/usr/bin/env bun`, imports `../session-band-plugin/hooks/outcome.ts`)
- Test: `scripts/pi-outcome.test.mjs`

**Interfaces:**
- Consumes: `deriveOutcome` (Task 3), `pi-checks.mjs` (Task 4).
- Produces: `pi-outcome <task-id> [--json] [--check]`. It prints one line, `pi#<id> <outcome>[ <round>/3][ · review waiting]`. `--json` prints `{id, outcome, round, tone, reviewWaiting}`. `--check` runs `pi-checks <cwd> <session-id> --no-steer` first. Input sources: `pueue status --json` (state, exit, cwd, label), session id `pueue-<label>`, the check record, `git` HEAD and diff in `cwd`, the pending directory `<review root>/.pi/agent-review/pending/`, `herdr pane get` when a pane file exists, and the mtime of the newest session log matching `*_pueue-<label>.jsonl` under `~/.pi/agent/sessions/`. Exit codes: 0 when the run is found, 2 for an unknown task id.

- [ ] **Step 1:** Write tests with a stub `pueue` (`PUEUE_BIN`) and a temp state directory: `prints checks passed for a passing record`, `--json carries round and reviewWaiting`, `unknown task exits 2`.
- [ ] **Step 2:** Run `node --test scripts/pi-outcome.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement. Gather the inputs above, call `deriveOutcome` and print.
- [ ] **Step 4:** Run `node --test scripts/*.test.mjs`. Expected: all pass.
- [ ] **Step 5:** Commit: `feat(scripts): pi-outcome prints a Pi run's honest outcome`.

---

## Done when

- `cd pi/.pi/agent/extensions/agent-review && bun test`, `python3 scripts/tests/test_spec_loop.py`, `node --test scripts/*.test.mjs` and `cd session-band-plugin && claude plugin test .` all pass.
- Live check: dispatch a `--tui` run against a worktree whose approved `SPEC.md` has one failing `verify:` line. The Monitor goes `running`, `checking`, `fixing 1/3`, and then `checks passed` once Pi fixes it. `pi-outcome <id>` agrees.
