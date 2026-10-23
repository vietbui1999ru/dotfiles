# Hand-off monitor: report back, bounded retry, ranked escalation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner: Pi.** session-band only. It must not edit `scripts/agent-review`, `pi/.pi/agent/extensions/agent-review/`, the post-run verifier or pi-lens.

**Goal:** When a tracked Pi hand-off ends, the Claude session hears about it without being asked; transient provider failures are retried a bounded number of times; everything else is escalated to the cheapest handler able to act on it, with Claude's usage headroom taken into account.

**Architecture:** session-band already tracks every `pueue add` Pi dispatch and notices when one leaves the running states (`hooks/handoff.tsx`, `poll()`, the finish notice). That point gains one call, `onHandoffFinished`, which:
1. classifies the run (`hooks/handoff-classify.ts`, pure)
2. retries it, or picks an escalation rank
3. reports into the session and, by rank, hands the problem to a subagent or to the main session

All re-dispatch goes through one function, so a later backend (agent-harness, pi-durable) replaces only that function.

**Tech Stack:** TypeScript mod (session-band), pueue, claude-tui (`status --json`), `claude plugin test`.

**Source decisions:** this session with the owner, 2026-10-23 (no separate design doc). Each decision below is quoted in the Global Constraints.

## Global Constraints

- **Retry only transient failures:** HTTP 429, 408 or 5xx (500, 502, 503, 504, 529), or a network error (`ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `socket hang up`).
- **Retry only when the run left no new commits and no pending review.**
- **At most 2 retries per task, waiting 60 s before the first and 300 s before the second.** Every retry is reported.
- **Never retry a 400, 401, 403 or 404, a test or gate failure, or an agent-review refusal.**
- **The escalation table:**

| Rank | Condition | Handler | Model · effort |
|---|---|---|---|
| 0 | A retry succeeded | toast only | — |
| 1 | Transient, both retries spent | subagent: wait, re-dispatch once more (continue the session), report | `haiku` · `low` |
| 2 | 404 model or endpoint; a known 400 pattern (`Invalid signature in thinking block`, `thinking` and `400` together) | subagent: pick the model or tier from `model-routing.md` and `~/.pi/agent/routing.env`, re-dispatch, report | `haiku` · `medium` |
| 3 | An unknown 400; a non-zero exit with no HTTP error | subagent: read the pueue log tail and the run's commits, explain, propose a fix, **no edits** | `sonnet` · `medium` |
| 4 | Tests or the gate failed; a pending review with a broken result; a task that failed again after an automatic re-dispatch | main-session turn | session model · `high` |
| — | 401 or 403 | the owner only, by `$.ui.notify`; no agent | — |

- **Reports may start a Claude turn by themselves** (owner's decision): if the session is idle, the report is submitted at once; if a turn is running, it waits for `turn.complete`.
- **Re-dispatch uses the `plan-handoff.md` command:** `pueue add -i --print-task-id --label <label> -w <worktree> -- "pi --model <model> --session-id <id> -p \"$(cat <file>)\" < /dev/null"`.
  - **Continue** (ranks 1 and 2): reuse the run's own `--session-id`, and only when it has no pending review.
  - **Fresh** (rank 3 or 4, after a change): a new slug and an explicit model.
- **Chain cap:** each re-dispatch records its parent task; at most **3** automatic dispatches per chain, after which only the owner restarts it.
- **Tiers:** a re-dispatch takes its model from `routing.env`, and may move up at most one tier, to `PI_DELEGATE_HIGH_MODEL` at most.
- **Headroom switch** (owner's decision: warn and switch):
  - Claude is **tight** when `claude-tui status --json` reports the five-hour `used_pct` above 70, or the seven-day `used_pct` above the Pro pace `20 × (elapsed days of the window ÷ 7)`.
  - While tight, ranks 1–3 are handled by a Pi dispatch on the same table's task (no Claude subagent), and the session gets a one-line warning with both percentages.
  - Rank 4 still goes to the main session.
  - The governor planned in agent-harness will replace this rule later.
- An agent never approves or skips a review, and never touches credentials.
- `$` crosses an import only into `function` declarations; atom keys are declared in `types/index.d.ts`.

## Review Focus

- A finished task seen twice (two polls, or a reload) is handled once: classification and escalation are keyed by task id plus finish time. (Task 2.)
- A retry that itself fails counts against the same budget of 2, not a fresh one. (Task 2.)
- A log mentioning "500" in program output (a test name, a byte count) must not read as an HTTP 500: match only status patterns from the provider error line. (Task 1.)
- `claude-tui` missing or failing means "unknown", which is treated as not tight: never block on the meter. (Task 4.)
- The session busy for a long time: queued reports keep their order and are sent together at the next `turn.complete`. (Task 3.)

---

### Task 1: Classify a finished run

**Files:**
- Create: `session-band-plugin/hooks/handoff-classify.ts`
- Test: `session-band-plugin/hooks/handoff-classify.test.ts`

**Interfaces:**
- Produces:
  - `export type RunOutcome = { kind: 'success' | 'transient' | 'auth' | 'model' | 'known-400' | 'unknown-400' | 'failed' | 'gate'; status?: number; evidence?: string }`
  - `export const classifyRun = (input: { exit: 'Success' | 'Killed' | { Failed: number }; logTail: string }): RunOutcome`. It matches provider error lines (`status <n>`, `HTTP <n>`, `"status":<n>`, `overloaded`) and the network errors listed in Global Constraints. `gate` is a log containing `agent-review: input refused` or a post-run-verifier failure line. `evidence` is the matched line, cut to 200 characters.
  - `export const rankFor = (outcome: RunOutcome, retriesSpent: number, chainDepth: number): 0 | 1 | 2 | 3 | 4 | 'owner'`, implementing the table.
- [ ] **Step 1–5:** tests `'429, 503 and ECONNRESET are transient'`, `'a 401 goes to the owner'`, `'Invalid signature in thinking block is a known 400'`, `'"500 tests passed" is not an HTTP 500'`, `'a gate refusal is rank 4'`, `'transient after 2 retries is rank 1'`; run `claude plugin test .` in `session-band-plugin` (FAIL), implement, run (PASS) plus `claude plugin validate .`; commit `feat(handoff): classify finished Pi runs`.

### Task 2: Bounded retry

**Files:** create `session-band-plugin/hooks/handoff-retry.ts`; modify `hooks/handoff.tsx` (call `onHandoffFinished` where the finish notice is raised in `poll()`); test `handoff-retry.test.ts`.

**Interfaces:**
- Produces:
  - `export type RetryRecord = { taskId: number; finishedMs: number; attempts: number; chain: number[]; handled: boolean }`, kept in a session-band atom (`handoffRetries`) keyed by task id.
  - `export async function onHandoffFinished($: EngineInterface, item: TrackedTask): Promise<void>`. It skips a `(taskId, finishedMs)` already handled. It reads the log tail with `pueue log --json <id>`, the commits since the task's start in its `cwd`, and pending reviews with `agent-review list --json --offline`. On `transient` with no commits and no pending review and `attempts < 2`, it schedules `pueue restart --in-place <id>` after 60 or 300 s through `$.clock`, increments `attempts`, and reports `retry N/2 for task <id> (<status>)`. Otherwise it passes the outcome and rank to Task 3.
- [ ] **Step 1–5:** tests `'a transient failure is restarted after 60 s, then 300 s, then escalated'`, `'a run with new commits is never retried'`, `'the same finish seen twice is handled once'`; run, implement, run, commit `feat(handoff): bounded retry of transient Pi failures`.

### Task 3: Report into the session

**Files:** create `session-band-plugin/hooks/handoff-report.ts`; modify `hooks/register.tsx`; test `handoff-report.test.ts`.

**Interfaces:**
- Produces:
  - `export const reportText = (item: TrackedTask, outcome: RunOutcome, rank: number | 'owner', action: string): string`. It returns one short block with the task id and label, the outcome and `evidence`, the commit count, whether a review is pending, the rank and handler, and what was done.
  - `export async function report($: EngineInterface, text: string): Promise<void>`: when no turn is running (a `turn.start`/`turn.complete` atom), `$.prompt.submit({ text })` at once; otherwise queue it, and on `turn.complete` without `e.agentId` submit all queued reports as one message, oldest first. Rank `'owner'` uses `$.ui.notify` only, and never submits.
- [ ] **Step 1–5:** tests `'an idle session gets the report at once'`, `'a busy session gets queued reports together after the turn'`, `'a 401 notifies the owner and submits nothing'`; run, implement, run, commit `feat(handoff): report finished hand-offs into the session`.

### Task 4: Escalation handlers, headroom and re-dispatch

**Files:** create `session-band-plugin/hooks/handoff-escalate.ts`; test `handoff-escalate.test.ts`.

**Interfaces:**
- Produces:
  - `export async function dispatchPi($: EngineInterface, req: { worktree: string; promptFile: string; model: string; sessionId?: string; parent: number }): Promise<number | undefined>`. This is the single re-dispatch function. It builds the Global Constraints command (a continue reuses `sessionId`; a fresh dispatch builds `pueue-<label>-<8 hex>`), refuses past the chain cap, and returns the new task id.
  - `export const claudeTight = (status: unknown, nowMs: number): { tight: boolean; five?: number; seven?: number }`. It reads `subscriptions.claude.quota` from `claude-tui status --json` (windows `five_hour` and `seven_day`, `used_pct`, `resets_at`). The Pro pace uses the seven-day window's elapsed fraction (`1 − (resets_at − now) / 7 days`). Unknown means not tight.
  - `export async function escalate($: EngineInterface, item: TrackedTask, outcome: RunOutcome, rank: 1 | 2 | 3 | 4): Promise<string>`:
    - ranks 1–3 run `$.agent.spawn({ prompt, model, effort, tools })` with the table's model and effort, where tools are `Read` and `Grep` plus `Bash` for ranks 1–2 (the prompt tells the agent to dispatch only through the command it is given) and no `Bash` for rank 3;
    - when `claudeTight` holds, ranks 1–3 call `dispatchPi` instead, with a prompt describing the failure and the table's action;
    - rank 4 returns text for `report`, which starts a main-session turn;
    - the returned string is the action line `report` includes.
- [ ] **Step 1–5:** tests `'rank 2 spawns haiku medium with the routing table'`, `'rank 3 gets no Bash'`, `'tight Claude sends ranks 1–3 to Pi and warns'`, `'the chain cap stops a fourth dispatch'`, `'a continue reuses the session id; a fresh one does not'`, `'a missing claude-tui is not tight'`; run, implement, run (`claude plugin test .` all green, `claude plugin validate .`), commit `feat(handoff): ranked escalation, headroom switch and re-dispatch`.
