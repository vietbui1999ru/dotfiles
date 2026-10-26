# Diff review C: batches, delivery and replies — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner: Pi.** Requires plan A (absorb) merged and plan B's `review-thread.ts`.

**Goal:** The person's thread entries for one agent go out as one batch after that agent's turn ends, reach it exactly once, and its answer comes back into the threads through a structured channel.

**Architecture:** A batch queue per worktree. Claude sessions get batches through `prompt.submit` (this session, at `turn.complete`) or `session.send` (another session); they answer with a mod tool `review_reply`. Pi sessions get batches by resuming the session through pueue; they answer by running `scripts/review-reply`. Both write plan B's thread format.

**Tech Stack:** TypeScript mod (session-band), Python 3 CLI (stdlib only, like `scripts/agent-review`), pueue, `claude plugin test`, `python3 -m unittest`.

**Spec:** `docs/superpowers/specs/2026-10-23-diff-review-pane-design.md` (sections "Delivery to the original agent", "Model and effort per thread", "Designer's calls after the builder check").

## Global Constraints

- Notes never interrupt a running turn: a batch is delivered only when its agent is between turns.
- A batch is written to disk before it is shown as sent (`queued`).
- Batch text's first line is exactly `[review-batch <uuid>]` (plan A's marker); nothing precedes it.
- Pi dispatch follows `plan-handoff.md`: `pueue add -i --print-task-id --label <label> -w <worktree> -- "pi --model <model> --session-id <piSessionId> -p \"\$(cat <batchFile>)\" < /dev/null"`. Here `--session-id` deliberately **reuses** the original session (resume); never invent a new id.
- No-reply timeout: 30 minutes after `delivered` (designer's call).
- `$` crosses an import only into `function` declarations.

## Review Focus

- The same batch delivered twice (a retry after a crash between send and mark) is shown once: the second `answered` for one batch id is ignored. (Task 3, Task 4.)
- A reply naming an unknown or not-yet-delivered batch id is refused with a message, and writes nothing. (Task 3, Task 4.)
- A Claude session whose turn completes while two batches are queued gets them as one message, oldest first. (Task 2.)
- A Pi session whose original model cannot be found is not guessed: the batch stays `queued` with reason `no model` and the pane offers the cycler. (Task 5.)
- A subagent's `turn.complete` (`e.agentId` set) never triggers delivery. (Task 2.)

---

### Task 1: Batch building and the queue

**Files:**
- Create: `session-band-plugin/hooks/review-batch.ts`
- Test: `session-band-plugin/hooks/review-batch.test.ts`

**Interfaces:**
- Consumes: `ThreadEntry`, `AgentKey`, `threadDir` (plan B).
- Produces:
  - `export type BatchState = 'queued' | 'delivered' | 'answered' | 'no-reply'`
  - `export type Batch = { id: string; agent: AgentKey; entryIds: string[]; state: BatchState; queuedAt: string; deliveredAt?: string; answeredAt?: string; reason?: string; model?: string; effort?: string }`
  - `export const queueFile = (worktree: string): string` → `<threadDir>/queue.jsonl` (append-only; the latest line per batch id wins)
  - `export const buildBatchText = (batchId: string, entries: readonly ThreadEntry[], replyHow: 'tool' | 'cli'): string` — first line the marker; then per file a heading `## <file>`, each comment as `- L<line>: <text>` (no `L` when unanchored), each patch in a ```` ```diff ```` fence with its entry id; then the reply instructions: for `'tool'`, call `review_reply` once per file; for `'cli'`, run `$HOME/dotfiles/scripts/review-reply --worktree <worktree> --batch <id> --file <file> --verdict agree|clapback --text <text> [--patch-file <path>]`; a disagreement must be a `clapback` with a reason.
  - `export async function enqueue($: EngineInterface, worktree: string, agent: AgentKey, entries: readonly ThreadEntry[]): Promise<Batch>`
  - `export async function readQueue($: EngineInterface, worktree: string): Promise<Batch[]>`
  - `export async function markBatch($: EngineInterface, worktree: string, id: string, state: BatchState, extra?: Partial<Batch>): Promise<void>`
  - `export const expireDelivered = (batches: readonly Batch[], nowMs: number): Batch[]` — `delivered` older than 30 minutes become `no-reply`.

- [ ] **Step 1: Write the failing tests**: `buildBatchText` output starts with `[review-batch <id>]\n`, lists `- L12: why?` under `## src/a.ts`, fences patches, and contains `review_reply` (tool) or `scripts/review-reply` (cli); the queue round-trips with latest-state-wins; `expireDelivered` at 29 and 31 minutes.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: pass.
- [ ] **Step 5: Commit**: `feat(review): batch queue for agent feedback`.

### Task 2: Delivery to Claude sessions

**Files:**
- Create: `session-band-plugin/hooks/review-deliver.ts`
- Modify: `session-band-plugin/hooks/register.tsx`
- Test: `session-band-plugin/hooks/review-deliver.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `export const register: Register` — on `turn.complete` without `e.agentId`, take this session's `queued` batches (agent `claude:<own session id>`), join their texts oldest first into one message, `$.prompt.submit({ text })`, then mark each `delivered`.
  - A batch whose `model` (from the pane's cycler) differs from the session's goes to a fresh answerer instead: `$.agent.spawn({ prompt, model, effort, tools: ['Read', 'Grep', 'Glob', 'mcp__session-band__review_reply'] })`, with the batch text, the file diffs and the session's plan file (if any) in `prompt`; its replies carry `model` and `effort`, and the pane labels them fresh.
  - `export async function deliverToSession($: EngineInterface, worktree: string, batch: Batch, sessionId: string): Promise<void>` — another Claude session: `$.session.send({ to: { sessionId }, text })`; mark `delivered` only if the send resolves delivered; otherwise keep `queued` with `reason`.

- [ ] **Step 1: Write the failing tests**: `'queued batches go in as one message after the turn ends'` (two batches → one `prompt.submit`, both `delivered`); `'a subagent turn end delivers nothing'`; `'a refused send stays queued with its reason'`.
- [ ] **Step 2–4:** run (FAIL), implement, run `claude plugin test .` + `validate` (PASS).
- [ ] **Step 5: Commit**: `feat(review): deliver feedback to Claude sessions between turns`.

### Task 3: The `review_reply` tool

**Files:**
- Create: `session-band-plugin/hooks/review-reply.ts`
- Modify: `session-band-plugin/hooks/register.tsx`
- Test: `session-band-plugin/hooks/review-reply.test.ts`

**Interfaces:**
- Consumes: `appendEntry` (plan B), `readQueue`, `markBatch` (Task 1).
- Produces: a tool registered in `session.start` with `$.tool.register({ name: 'review_reply', description, inputSchema })`, answered by a `tool.call` hook on `mcp__session-band__review_reply`. Input: `{ batch: string; file: string; verdicts: { entry: string; verdict: 'agree' | 'clapback' }[]; text: string; patch?: string }`. It appends one `reply` entry (or `clapback` when any verdict is `clapback`) with `batch`, `replyTo`, `model` and `effort` of the current turn, and marks the batch `answered` once every file of the batch has a reply. Unknown or undelivered batch → tool error text `unknown or undelivered review batch <id>`, nothing written. A second reply for a file already answered in that batch is ignored.

- [ ] **Step 1–5:** tests `'a reply is written and the batch is answered'`, `'an unknown batch is refused and writes nothing'`, `'a duplicate reply is ignored'`; run, implement, run, commit `feat(review): review_reply tool for Claude agents`.

### Task 4: `scripts/review-reply` for Pi

**Files:**
- Create: `scripts/review-reply` (Python 3, executable, stdlib only)
- Test: `scripts/tests/test_review_reply.py`

**Interfaces:**
- Produces: `review-reply --worktree <path> --batch <id> --file <file> --verdict agree|clapback --text <text> [--entry <id>]... [--patch-file <path>]`, writing the same entry shape and queue update as Task 3 (same refusal and duplicate rules). Exit 0 on success, 2 on refusal with one line on stderr.

- [ ] **Step 1–5:** tests mirror Task 3 against a temp worktree; run `python3 scripts/tests/test_review_reply.py` (FAIL, then PASS); commit `feat(review): review-reply CLI for Pi agents`.

### Task 5: Delivery to Pi sessions

**Files:**
- Modify: `session-band-plugin/hooks/review-deliver.ts`
- Test: `session-band-plugin/hooks/review-deliver.test.ts`

**Interfaces:**
- Produces:
  - `export const piModelFrom = (pueueCommand: string): string | undefined` — the value after `--model` in a pueue task's command.
  - `export async function deliverToPi($: EngineInterface, worktree: string, batch: Batch, piSessionId: string): Promise<void>` — writes the batch text to `<threadDir>/batches/<id>.md`, finds the model (the batch's own `model` from the cycler, else `piModelFrom` of the pueue task whose label or command carries `--session-id <piSessionId>`), and runs the Global Constraints' `pueue add` line. No model → stay `queued`, `reason: 'no model'`. Delivers only when no pueue task for that session is `Running`. Triggered on send, and retried for every `queued` Pi batch on a 60-second `$.clock` tick while the session runs; the same tick applies `expireDelivered`.

- [ ] **Step 1–5:** tests `'piModelFrom reads --model'`, `'a Pi batch is dispatched with the original session id and model'` (assert the exact argv), `'no model keeps the batch queued'`, `'a running Pi task delays delivery'`; run, implement, run, commit `feat(review): deliver feedback to Pi sessions through pueue`.
