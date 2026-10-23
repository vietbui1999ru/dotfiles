# Diff review D: the review pane — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner: Pi**, except Task 5's approval wiring, which calls the existing gates and must be reviewed by Claude before merge. Requires plans A, B and C.

**Goal:** A `Review` pane: one tab per unapproved file in the worktree, a highlighted diff, comments, questions and proposed patches, the thread with the original agent, a model and effort cycler, landing and committing patches, overrule, and approval; `/gates` opens it.

**Architecture:** `hooks/review-pane.tsx` draws state that `hooks/review-sources.ts` gathers (Pi pending records, Claude session touch states, matching specs) and plans B and C store. Landing applies a patch with `git apply` and commits with `commit-funnel`.

**Tech Stack:** TypeScript mod (session-band), `Code` element (`format: 'diff'`), `Input` element, `claude plugin test`.

**Spec:** `docs/superpowers/specs/2026-10-23-diff-review-pane-design.md` (all sections; "Order of operations", "Approval", "Landing and committing patches", "Two writers").

## Global Constraints

- The cycler's warning text, exactly: `switching model re-reads the full context (no cache)`.
- The overrule trailer, exactly: `Overruled: agent warned "<first 200 characters of the clapback text>"`.
- Commits go only through `$HOME/dotfiles/scripts/commit-funnel --worktree <worktree> -F <message file> <paths>`.
- Pi-run and spec approval only through `agent-review approve` and `ac-run approve` (their dialogs). Claude-session approval: two presses of `a` in the pane, then plan B's `approveSession`.
- Land and commit only while the owning agent is between turns; otherwise wait like a note.
- Order before a Pi-run approval: land patches, then re-snapshot (plan A's absorb or a fresh run end), then approve.
- A pane draws about 100,000 characters: page a long diff by hunk.
- No comment or marker is ever written into a source file.
- Follow session-band pane conventions: `PANE_TITLES` and `JUMP_KEYS` in `hooks/pane-nav.ts`, `j`/`k`/`q`, `b`/`f` pane cycling.

## Review Focus

- An agreed patch that no longer applies (the file moved on) is not forced: the thread gets a `system` entry `patch no longer applies`, the patch stays proposed. (Task 4.)
- A binary or deleted file shows a one-line summary instead of a diff, and cannot take a patch. (Task 1.)
- A file touched by two agents shows both agent names and is approved only when both are, or by an explicit approve-for-all. (Task 5.)
- Closing and reopening the pane, or restarting the session, shows the same threads and batch states. (Task 2.)
- The desktop surface: the pane renders there (verify in the desktop app once; record the result in the PR). (Task 1.)

---

### Task 1: Sources and the tabbed diff view

**Files:**
- Create: `session-band-plugin/hooks/review-sources.ts`, `session-band-plugin/hooks/review-pane.tsx`
- Modify: `session-band-plugin/hooks/register.tsx`, `session-band-plugin/hooks/pane-nav.ts` (add `review: 'Review'`), `session-band-plugin/types/index.d.ts` (atom `review`)
- Test: `session-band-plugin/hooks/review-pane.test.ts`

**Interfaces:**
- Produces:
  - `export type ReviewAgent = { key: AgentKey; kind: 'pi' | 'claude' | 'spec'; label: string; files: string[]; base: string; runId?: string; specPath?: string }`
  - `export async function loadAgents($: EngineInterface, worktree: string): Promise<ReviewAgent[]>` — Pi: `agent-review list --all --json` entries owned by this worktree plus each pending record's `files`, `base`, `session` (plan A); Claude: every `SessionReview` (plan B) whose `worktree` matches, `files = touched`, `base = baseTree`; specs: as `/gates` finds them.
  - `export async function fileDiff($: EngineInterface, worktree: string, base: string, file: string): Promise<string>` — `git diff --no-renames <base> -- <file>` against the working tree.
  - A spec's tab is not a diff: it shows `ac-run show <path>` (each acceptance criterion with its verify command) and the last `ac-run check <path>` result table.
  - Pane id `review`, opened by `/review` and by `/gates` (Task 6). Tabs: one per (agent, file), `[` and `]` move between tabs, `j`/`k` move between hunks.
- [ ] **Step 1–5:** tests `'one tab per agent file, Pi and Claude together'`, `'a tab shows the file diff as a Code diff'`, `'a binary file shows a summary'`, `'a long diff is paged by hunk'`; run `claude plugin test .` (FAIL), implement, run (PASS) plus `claude plugin validate .`; commit `feat(review): review pane with a diff tab per unapproved file`.

### Task 2: Thread view, comments and proposed patches

**Files:** modify `review-pane.tsx`; test `review-pane.test.ts`.

**Interfaces:**
- Consumes: `readThread`, `appendEntry` (plan B).
- Produces: under the diff, the file's thread in order (`person`, `agent`, `pane` entries; a `clapback` drawn in a distinct colour with its reason); `c` opens an `Input` for a comment anchored to the current hunk's first new line (`line`); `p` opens a multi-line `Input` prefilled with the current hunk's new lines, and its submitted text becomes a `patch` entry holding the unified diff from those lines to the typed ones; entries are appended as `author: 'person'`, unsent until `s`.
- [ ] **Step 1–5:** tests `'a comment is stored with its line'`, `'a typed edit becomes a patch entry with a unified diff'`, `'threads survive closing and reopening the pane'`; run, implement, run, commit `feat(review): comment on and propose edits to a diff hunk`.

### Task 3: Send, batch states, cycler and notifications

**Files:** modify `review-pane.tsx`; test `review-pane.test.ts`.

**Interfaces:**
- Consumes: `enqueue`, `readQueue` (plan C).
- Produces: `s` sends the agent's unsent person entries as one batch (plan C `enqueue`); each entry shows its batch state (`queued`, `delivered`, `answered`, `no reply`, with `resend` on `no reply`); `m` cycles the thread's answerer through `same as agent` (default), `haiku · low`, `sonnet · medium`, `opus · high`, and the Pi models of `model-routing.md`'s implementation tiers, storing the choice on the next batch (`model`, `effort`); any choice other than `same as agent` shows the Global Constraints warning; an `answered` batch raises a toast naming the file and marks the tab unread until viewed.
- [ ] **Step 1–5:** tests `'send queues one batch per agent'`, `'the cycler warns when leaving same as agent'`, `'an answer marks its tab unread and toasts'`, `'no reply offers resend'`; run, implement, run, commit `feat(review): send feedback, track it, choose who answers`.

### Task 4: Landing, overrule and commits

**Files:** create `session-band-plugin/hooks/review-land.ts`; modify `review-pane.tsx`; test `review-land.test.ts`.

**Interfaces:**
- Produces:
  - `export const overruleTrailer = (clapbackText: string): string` (Global Constraints' exact text)
  - `export async function landPatch($: EngineInterface, worktree: string, entry: ThreadEntry, overruled?: ThreadEntry): Promise<'landed' | 'conflict' | 'waiting'>` — `waiting` while the owning agent is mid-turn (this session: a `turn.start`/`turn.complete` atom; other Claude sessions: their state from `claude agents --json`; Pi: a `Running` pueue task for the session); else `git apply --check` then `git apply`, then commit the touched paths via `commit-funnel` with message `review: apply <agreed|overruled> patch to <file>` plus the trailer when overruled; `conflict` appends the `system` entry `patch no longer applies`.
  - In the pane, an agent `reply` with verdict `agree` lands the patch automatically; on a `clapback`, `O` overrules (lands with the trailer) and `A` accepts the agent's alternative patch (lands it as agreed).
- [ ] **Step 1–5:** tests `'an agreed patch lands and commits through commit-funnel'` (assert the funnel argv), `'an overrule commit carries the trailer'`, `'a stale patch reports conflict and stays proposed'`, `'a busy agent makes landing wait'`; run, implement, run, commit `feat(review): land agreed or overruled patches and commit them`.

### Task 5: Approval (Claude reviews before merge)

**Files:** modify `review-pane.tsx`; test `review-pane.test.ts`.

**Interfaces:**
- Consumes: `approveArgv` (`hooks/pane.tsx`), `acRunArgv` (`hooks/gates.ts`), `approveSession` (plan B).
- Produces: `a` on a Pi agent runs `agent-review approve <runId>` (the dialog) after landing; on a spec, `ac-run approve <path>`; on a Claude session, two presses then `approveSession`. A file shared by two agents is marked `shared` and stays unapproved until both agents are approved, unless `A` on the second press approves it for all. A run whose snapshot is stale (`tree-changed`) is never approved: the pane says to wait for the re-snapshot. `r` returns the current file instead of accepting it: for a Claude session it stays in `touched` and a `comment` entry asking for rework is queued; for a Pi run, returned files are recorded as `changed` only in the approval's decision, never as a notes or patch decision.
- [ ] **Step 1–5:** tests `'Pi approval goes through agent-review approve'` (argv), `'a Claude session needs two presses'`, `'a shared file waits for both agents'`, `'tree-changed is reported, not retried'`, `'returning a Claude file keeps it unapproved and queues a note'`; run, implement, run, commit `feat(review): approve from the review pane through the existing gates`.

### Task 6: `/gates` opens the pane, and findings in the tab

**Files:** modify `session-band-plugin/hooks/gates.tsx`, `review-pane.tsx`; tests `gates-pane.test.ts`, `review-pane.test.ts`.

**Interfaces:**
- Produces: in `/gates`, `v` on a review or spec row opens the `review` pane on that agent; each tab shows `floor-guard` findings for the file (from `$HOME/dotfiles/scripts/floor-guard --base <base>` filtered to the file) and pi-lens diagnostics when present.
- [ ] **Step 1–5:** tests `'v in gates opens the review pane on that agent'`, `'floor-guard findings for the file appear in its tab'`; run, implement, run (`claude plugin test .` all green, `claude plugin validate .`), commit `feat(review): open review from gates and show findings`.
