# Diff review A: absorb Pi runs into one pending record per session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner: Claude.** This changes the review gate (`plan-handoff.md`: Pi must not edit the gate that reviews Pi). Plans B, C and D depend on it.

**Goal:** A pane review batch sent to a Pi session that has a pending review starts a new run from that review's base and retires the old record, instead of being refused.

**Architecture:** The agent-review Pi extension's `input` hook refuses all input while a review is pending. It gains one exception: input whose first line is a review-batch marker, from the same Pi session that wrote every pending record, absorbs them. Every other input is refused as today.

**Tech Stack:** TypeScript Pi extension, `node:test` run by `bun test`.

**Spec:** `docs/superpowers/specs/2026-10-23-diff-review-pane-design.md`, section "Designer's calls after the builder check", first bullet.

## Global Constraints

- Any input that is not an absorbable batch is refused exactly as today (same notice, same `reportPrintFailure` text).
- No change to `scripts/agent-review` (`approve`, `skip`, `list`), the decision format, or `:AgentReview`.
- Fail closed: any doubt (no session id, a tampered or errored record, a record from another session) means refuse.

## Review Focus

- A crash after the new run starts but before the old record is retired leaves the old record pending: the next input must still be refused, never absorbed twice into a broken base. (Test in Task 2.)
- Two pending records from the same session: absorb from the **oldest** `base`, retire both. (Task 2.)
- `ctx.sessionManager` missing or returning `""`: refuse. (Task 2.)
- A record written before this change has no `session` field: refuse (never guess ownership). (Task 2.)
- A marker that is not on the first line, or with a malformed id, is ordinary input: refuse. (Task 1.)

---

### Task 1: Batch marker and the session field

**Files:**
- Modify: `pi/.pi/agent/extensions/agent-review/index.ts` (the `Pending` and `Active` types; the code that writes the record at run end, near the `base: run.base, baseTree: run.baseTree` record literals)
- Test: `pi/.pi/agent/extensions/agent-review/agent-review.absorb.test.ts` (new; reuse the `makeRepo`, `start`, `pendingRun` helpers by copying them from `agent-review.approve.test.ts`, extended so `start(root, sessionId)` puts `sessionManager: { getSessionId: () => sessionId }` on `ctx`)

**Interfaces:**
- Produces: `export const REVIEW_BATCH = /^\[review-batch ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/` and `export const reviewBatchId = (text: string): string | undefined` (the id when the **first line** matches, else `undefined`).
- Produces: `Pending.session?: string` and `Active.session: string` (the Pi session id from `ctx.sessionManager?.getSessionId?.() ?? ""`), written into every new pending record.

- [ ] **Step 1: Write the failing tests**
  - `reviewBatchId("[review-batch 0f8fad5b-d9cb-469f-a165-70867728950e]\nnotes")` returns the id; `reviewBatchId("notes\n[review-batch 0f8f…]")`, `reviewBatchId("[review-batch nope]")` and `reviewBatchId("")` return `undefined`.
  - `test("a new pending record names the Pi session that wrote it")`: `start(root, "sess-1")`, run once; the pending JSON has `session === "sess-1"`.
- [ ] **Step 2: Run** `bun test agent-review.absorb.test.ts` from the extension folder. Expected: FAIL (`reviewBatchId` not exported; `session` undefined).
- [ ] **Step 3: Implement** the regex, `reviewBatchId`, and the `session` field (captured when the run starts in the `input` hook, copied into both record literals at run end).
- [ ] **Step 4: Run** `bun test` (whole folder). Expected: all pass, including the 78 existing tests.
- [ ] **Step 5: Commit** via `$HOME/dotfiles/scripts/commit-funnel --worktree <session worktree> -F <msg> <paths>`: `feat(agent-review): record the Pi session on pending reviews`.

### Task 2: Absorb in the `input` hook

**Files:**
- Modify: `pi/.pi/agent/extensions/agent-review/index.ts`, the `pi.on("input", …)` handler (today it returns `{ action: "handled" }` whenever `listPending(root)` is non-empty).
- Test: `agent-review.absorb.test.ts`.

**Interfaces:**
- Consumes: `reviewBatchId`, `Pending.session` (Task 1); existing `listPending`, `snapshot`, `setRef`, `clearRef`-style ref deletion (`update-ref -d refs/agent-review/<id>/{base,end}`).
- Produces: `export const absorbable = (pending: readonly Pending[], sessionId: string, text: string): Pending | undefined` — the oldest record (by `startedAt`) when absorbing is allowed, else `undefined`. Allowed only if `reviewBatchId(text)` is defined, `sessionId !== ""`, and every record has `session === sessionId`, no `tamper`, no `error`, and valid `base`/`baseTree` hashes.

- [ ] **Step 1: Write the failing tests** (each uses a real repo and `pendingRun`):
  - `"a review batch from the same session absorbs the pending run"`: run A pending (session `s1`); input `[review-batch <uuid>]\nfix foo`; settle. Pending dir holds exactly one `.json`; its `base` equals A's `base`; `refs/agent-review/<A>` no longer exists.
  - `"the absorbed run's files cover both runs"`: A edits `a.txt`, the batch run edits `b.txt`; the one record's `files` lists both.
  - `"plain input is still refused while a review is pending"`: input `hello` returns `{ action: "handled" }`; A's record unchanged.
  - `"a batch from another session is refused"`: A from `s1`, batch input with session `s2`: refused, A unchanged.
  - `"a tampered, errored or session-less record is never absorbed"`: patch A's JSON with `tamper: true`, then `error: "x"`, then delete `session`; each refuses.
  - `"no session id refuses"`: `start(root, "")`: refused.
  - `"two records from one session absorb from the oldest base"`: two pending records for `s1` (write the second by hand with a later `startedAt`); after the batch, one record, `base` equal to the older one's.
  - `"a leftover record after an interrupted absorb is refused for plain input"`: after an absorb, write A's pending JSON back by hand (simulating a crash before retiring); plain input `hello` is refused and A's record is unchanged.
- [ ] **Step 2: Run** `bun test agent-review.absorb.test.ts`. Expected: the absorb tests FAIL (input refused).
- [ ] **Step 3: Implement** `absorbable`, then in the handler: when pending is non-empty, compute `absorbable(blocked, sessionId, event.text)`; if `undefined`, refuse exactly as today; else start the run as the normal path does but with `base`/`baseTree` from the returned record, set `active`, then delete every blocked record's pending JSON and refs. Order matters: retire only after `active` is set, so an interrupted retire leaves records that the next input refuses (fail closed).
- [ ] **Step 4: Run** `bun test` (whole folder). Expected: all pass.
- [ ] **Step 5: Commit** via the funnel: `feat(agent-review): absorb a session's pending review on a review batch`.
