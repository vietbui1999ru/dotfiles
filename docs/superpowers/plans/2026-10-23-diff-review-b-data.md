# Diff review B: threads, touch log and session approval — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Owner: Pi.** Data layer only; no UI. Plans C and D consume it.

**Goal:** Durable per-file review threads, a per-session record of the files a Claude session touched since its last approval, and session approval that resets it.

**Architecture:** Plain modules in `session-band-plugin/hooks/`. Threads are append-only JSONL files under the worktree's `.pi/agent-review/threads/` (agent-review's snapshots already exclude `.pi/`). Session touch state is JSON under `$HOME/.local/state/session-band/review/`, outside any repo.

**Tech Stack:** TypeScript mod (session-band), `claude plugin test` (`claude-code/testing`), git.

**Spec:** `docs/superpowers/specs/2026-10-23-diff-review-pane-design.md` (sections "What counts as unapproved", "The thread", "Approval").

## Global Constraints

- An engine call (`$`) may cross an import only into a `function` declaration, never an arrow function (`claude plugin validate` refuses it). Pure helpers may be arrows.
- Each `$.state` atom key is declared in `session-band-plugin/types/index.d.ts` under `PluginState['session-band']`.
- Nothing here writes inside source files; threads live under `.pi/`, session state outside the repo.
- Thread lines are language-neutral JSON: plan C's Python `scripts/review-reply` appends to the same files.

## Review Focus

- A truncated last line in a thread file (crash mid-append) must not lose the earlier entries: `parseThread` skips only the bad line. (Task 1.)
- A file path with spaces, `/` or unicode maps to one stable, reversible thread file name. (Task 1.)
- A Bash call that changes no files adds nothing; one that deletes a file adds it. (Task 2.)
- Edits to `.pi/` itself never count as touched. (Task 2.)
- A session with no state file yet starts its base at the first snapshot, not at an empty tree. (Task 3.)

---

### Task 1: Thread store

**Files:**
- Create: `session-band-plugin/hooks/review-thread.ts`
- Test: `session-band-plugin/hooks/review-thread.test.ts`

**Interfaces:**
- Produces:
  - `export type AgentKey = string` — `pi:<piSessionId>` or `claude:<claudeSessionId>`.
  - `export type ThreadEntry = { id: string; at: string; agent: AgentKey; file: string; kind: 'comment' | 'patch' | 'reply' | 'clapback' | 'overrule' | 'system'; author: 'person' | 'agent' | 'pane'; text: string; line?: number; patch?: string; batch?: string; verdict?: 'agree' | 'clapback'; replyTo?: string; model?: string; effort?: string }`
  - `export const threadDir = (worktree: string): string` → `<worktree>/.pi/agent-review/threads`
  - `export const threadFile = (worktree: string, agent: AgentKey, file: string): string` → `<threadDir>/<encodeURIComponent(agent)>/<encodeURIComponent(file)>.jsonl`
  - `export const parseThread = (text: string): ThreadEntry[]` (one JSON object per line; lines that do not parse, or lack `id`/`kind`/`file`, are skipped)
  - `export async function appendEntry($: EngineInterface, worktree: string, entry: ThreadEntry): Promise<void>` — durable append; resolves only after the write is on disk.
  - `export async function readThread($: EngineInterface, worktree: string, agent: AgentKey, file: string): Promise<ThreadEntry[]>`

- [ ] **Step 1: Write the failing tests**
  - `threadFile('/w', 'pi:abc', 'src/a b.ts')` equals `/w/.pi/agent-review/threads/pi%3Aabc/src%2Fa%20b.ts.jsonl`.
  - `parseThread` of two valid lines plus a truncated third returns the two entries in order.
  - `test('appendEntry then readThread round-trips entries in order')` with the kit's `fs.*` mocks: three appends, read back equal.
- [ ] **Step 2: Run** `claude plugin test .` in `session-band-plugin`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** For `appendEntry`, use the kit's `$.fs` append if it has one; otherwise read the file, write `<file>.tmp` with the new line added, and rename it over the original. Create the directory if missing.
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: all tests pass; no new validation errors.
- [ ] **Step 5: Commit**: `feat(review): durable per-file review threads`.

### Task 2: Touch log for Claude sessions

**Files:**
- Create: `session-band-plugin/hooks/review-touch.ts`
- Modify: `session-band-plugin/hooks/register.tsx` (register it), and if the kit refuses a second `tool.call` hook matching `{ tool: 'Bash' }`, call the recorder from `hooks/blast.tsx`'s Bash hook around `next(e)` instead
- Test: `session-band-plugin/hooks/review-touch.test.ts`

**Interfaces:**
- Produces:
  - `export type SessionReview = { sessionId: string; worktree: string; baseTree: string; touched: string[]; approvedAt?: string }`
  - `export const statePath = (home: string, sessionId: string): string` → `<home>/.local/state/session-band/review/<sessionId>.json`
  - `export async function snapshotTree($: EngineInterface, worktree: string): Promise<string>` — a tree hash of the worktree including untracked, unignored files and excluding `.pi/`, built with a throwaway index (`GIT_INDEX_FILE=<tmp> git add -A -- . ':!.pi'` then `git write-tree`), never touching the real index.
  - `export async function changedPaths($: EngineInterface, worktree: string, before: string, after: string): Promise<string[]>` (`git diff --name-only --no-renames <before> <after>`)
  - `export async function recordTouch($: EngineInterface, sessionId: string, worktree: string, paths: readonly string[]): Promise<void>` — adds repo-relative paths to `touched` (deduplicated, sorted), creating the state with `baseTree = await snapshotTree(...)` if absent.
  - `export const register: Register` — `tool.call` hooks: for `Edit`, `Write`, `NotebookEdit`, after a successful `next(e)` record the input's file path; for `Bash`, snapshot before `next(e)` and after, and record `changedPaths`.

- [ ] **Step 1: Write the failing tests** (real temp git repo through `process.run`, or the kit's process mocks returning fixed hashes):
  - `'an Edit records its file once'`: two Edits of `a.ts` → `touched` is `['a.ts']`.
  - `'a Bash call that changes nothing records nothing'`; `'a Bash call that deletes b.ts records b.ts'`.
  - `'edits under .pi are never recorded'`.
  - `'snapshotTree leaves the real index untouched'`: `git diff --cached --quiet` exits 0 before and after.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified; a failing snapshot must never fail the tool call (catch, record nothing, log once to debug with `$.ui.log(…, { to: 'debug' })`).
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: pass.
- [ ] **Step 5: Commit**: `feat(review): record files a Claude session touches`.

### Task 3: Session approval

**Files:**
- Modify: `session-band-plugin/hooks/review-touch.ts`
- Test: `session-band-plugin/hooks/review-touch.test.ts`

**Interfaces:**
- Produces:
  - `export async function readSession($: EngineInterface, sessionId: string): Promise<SessionReview | undefined>`
  - `export async function approveSession($: EngineInterface, sessionId: string): Promise<SessionReview>` — `baseTree` becomes the current snapshot, `touched` becomes `[]`, `approvedAt` is set.
  - `export async function ensureSessionBase($: EngineInterface, sessionId: string, worktree: string): Promise<void>` — called from `session.start`; writes the state with the current snapshot as `baseTree` only if none exists.

- [ ] **Step 1: Write the failing tests**: `'approval clears touched and moves the base'`; `'a file touched after approval appears again'`; `'session start keeps an existing base'`.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: FAIL.
- [ ] **Step 3: Implement**; wire `ensureSessionBase` into the existing `session.start` handling in `register.tsx`.
- [ ] **Step 4: Run** `claude plugin test .` and `claude plugin validate .`. Expected: pass.
- [ ] **Step 5: Commit**: `feat(review): approve a Claude session's touched files`.
