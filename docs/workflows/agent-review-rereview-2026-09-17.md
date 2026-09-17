# Agent Review — Re-review of the rebuild (2026-09-17)

Reviewed commit `93b18c8` ("feat(agent-review): capture one pending review per Pi run", unpushed),
the staged Neovim module `nvim/.config/nvim/lua/custom/agent_review.lua` with its staged
`init.lua` hunk, and the `post-run-verifier.ts` change. Spec: `agent-review.md`.

**Verdict:** component 2 is not safe to stow. Component 3 must not be committed as-is.

**How it was checked.** The reviewer ran the existing tests (5/5 pass). It also built a harness
with a fake Pi against temporary git repos, and ran it on the extension as committed and on a copy
with only the missing import added. Scenarios: no-change run, decision round trip, forged decision,
skip, duplicate events, two sessions, a 31 s repair, and a start-snapshot failure. It checked the
Neovim patterns with `nvim --clean --headless`, and read Pi's runtime (`runner.js`,
`agent-session.js`, `print-mode.js`, `interactive-mode.js`) plus the installed diffview and
gitsigns source. Nothing touched live repos or Pi and Neovim sessions.

**v1 scope note.** After this review, v1 was cut (see `agent-review.md`, "Scope and contract for
v1"). Findings about the override shortcut, print mode, the 7-day ref prune, and multi-session
guarantees beyond claim-by-rename are **deferred to v2** and marked below. Everything else must be
fixed in v1.

## Status of the first review's findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| 1 | Commits compared instead of trees | Fixed | ts:58, ts:23; no-change run leaves no pending and deletes refs |
| 2 | Review state inside snapshots | Fixed | ts:39, lua:59 |
| 3 | Neovim deleting the pending record | Fixed, but see N3 | Lua never deletes; rename-back at ts:71 |
| 4 | Fails open at run end | Partial | 30 s fallback ts:76, `active` cleared after write ts:62, error record ts:64; start-snapshot failure still fails open (N6), error-path write can itself throw with `active` stuck |
| 5 | Verifier settle after dispatching a repair | Partial | `repairQueuedGeneration` can't suppress a later settle (generation only increases), but the fallback timer isn't cleared (N2) |
| 6 | Pi cwd vs repo root | Fixed | ts:27; Lua note paths still cwd-relative (N7) |
| 7 | `<leader>ad` collision | Fixed | lua:149 uses `<leader>aD`; staged which-key has three accurate labels |
| 8 | Duplicate follow-ups | Partial | in-flight set + claim by rename; `*.tmp` ignored only incidentally by the UUID check; one spurious ENOENT warning on duplicates; two sessions broken (N3) |
| 9 | Unvalidated identifiers | Partial | TS validates `runId`, `baseTree`, `endTree`; `base`/`end` unvalidated in both components; Lua passes agent-writable `record.base` into diffview and gitsigns (lua:110-111); Lua UUID pattern too loose |
| 10 | Missing features | Mostly not fixed | status restore on `session_start` done; extension-input blocking done (ts:74); no-change ref cleanup done; shortcut, prune, print mode missing (**v2**) |
| 11 | Tamper check order, fail-closed mode read | Fixed for what exists | mtime read before pending write; missing mode file = on |
| 12 | Neovim details | Partial | `file` field, atomic `.tmp`, `pcall`, shared snapshot, patch `git diff endTree finalTree` done; broken: N4, N7, and the patch is `vim.trim`med (lua:48), dropping its final newline |
| 13 | Tests | Not fixed | tests 1–2 are real temp-repo snapshot tests; 3–4 are pure predicates; test 5 only asserts `"interactive" !== "extension"`; nothing drives the extension; tests leak temp directories |

## New findings (most severe first)

### N1 — Critical, confirmed: missing `basename` import crashes Pi

`agent-review.ts:78` calls `basename`, which the `node:path` import on line 6 doesn't include. Any
file event in `decisions/` (including the `mkdir` at `session_start`, and every decision write)
throws a `ReferenceError` inside the `fs.watch` callback. That becomes an uncaught exception, and
interactive Pi exits via `process.exit(1)` (`interactive-mode.js:3294`). No decision and no
`/review skip` can ever be processed.

Fix: import `basename`. Add extension-level integration tests; this shipped because no test loads
the extension.

### N2 — High, confirmed: repair turns over 30 s are snapshotted mid-repair

`ts:76` arms the 30 s fallback at the first `agent_settled`. If the verifier queued a repair, the
follow-up often starts a new low-level run: agent-review's async input handler delays queueing, so
no messages are queued yet and a separate settle happens. When that repair takes longer than 30 s,
the timer takes the end snapshot mid-repair. In the harness, `endTree` captured the broken state,
and the next repair input was then blocked, which silently killed the repair cycle. Repair edits
later appear to Pi as reviewer edits.

Fix: cancel the timer on every `agent_start` and every extension-sourced input during the active
run; re-arm it only at the next `agent_settled`. (Spec updated.)

### N3 — High, confirmed: claim failure resurrects another session's review

`ts:70-71`: when `rename(pending → processing)` fails with `ENOENT`, the catch still runs
`rename(processing → pending)`, restoring a record another session just claimed. In the
two-session harness, session B sent the follow-up and deleted the refs, but the pending record came
back: input stays blocked with the refs gone, and a later decision would send a second follow-up.

Same class: a malformed decision (for example, missing `patch`) throws in `needsFollowUp` *after*
`rm(processing)` and `deleteRefs`, so the review disappears with no follow-up.

Fix: rename back only if this call made the claim. Validate the decision's full shape before any
destructive step.

### N4 — High, confirmed from plugin source: Neovim shows the wrong diff

- `agent_review.lua:110`: diffview's `open(args)` flattens arguments by index
  (`utils.lua:1329`), so `{ base = X }` becomes no arguments, and diffview compares the working
  tree against the index instead of against the run's base. It must be `{ record.base }`.
- `agent_review.lua:137`: `reset_base()` without `true` resets only the current buffer; gitsigns'
  global base stays pinned to the run's base afterwards (`actions.lua:786-818`).

### N5 — High, confirmed by tracing: the agent's response to a review is never reviewed

Review-completion and skip follow-ups are delivered as `source: "extension"`
(`agent-session.js:1187`), so `ts:74` never starts a run for them. The edits the agent makes after
reading your decision are never reviewed. This was also a spec gap; the spec now requires marking
agent-review's own follow-up so it starts a reviewed run.

Print mode (**v2**): blocked input returns `handled` and print mode exits 0. The end snapshot runs
from `void finish` (ts:75) and may not complete before the runtime is disposed, leaving no pending
record.

### N6 — Medium, confirmed: remaining fail-open and startup gaps

- A start-snapshot failure throws inside the `input` handler; `runner.js:996` swallows it and the
  run proceeds unreviewed. Causes include a missing committer identity for `commit-tree`, the 15 s
  timeout on a large `git add -A` (clean/LFS filters make this likelier), and permissions. Spec now
  requires failing closed.
- No startup scan of `decisions/`: a decision written while Pi was down is never processed until it
  is rewritten.
- Concurrent `finish` calls (settle signal plus timer) can double-snapshot.

### N7 — Low, confirmed: Neovim note paths

`agent_review.lua:100`: the pattern requires a non-slash character after `diffview://`, but
diffview buffer names look like `diffview:///abs/.git/<rev>/path`, so resolution returns nil and
the `diffview://` name is stored. `agent_review.lua:102` uses `:.` (cwd-relative) instead of
repo-root-relative paths.

### N8 — Low: `.gitignore` change is unrelated

The uncommitted `.gitignore` change does not add `.pi/agent-review/`; it removes `/.obsidian/` and
adds nvim and panel entries from other work. The `agent-workflow` template already has the rule
(`scripts/agent-workflow:35`). Keep it out of agent-review commits.

## Readability

`agent-review.ts` packs about 10.5 KB into 80 lines: 21 lines exceed 160 characters, the longest is
826. Line 74 holds 15 statements (blocking, source gate, mode read, snapshot, refs, state setup);
line 70 packs claim, validate, delete and send into one `try`. That density hid N1 (an unimported
call inside a one-liner) and N3 (catch semantics invisible), and tracing N2 required unpacking lines
by hand. For the component whose job is to be audited, this materially impedes verification.

Fix: one statement per line, with named helpers (claim, validate, release).

## Other checks

- **Index seeding** (`git rev-parse --git-path index` copy): safe against lock races, since
  `index.lock` is renamed into place atomically. Split index works but can create or expire
  shared index files (low risk). Sparse index skips out-of-cone files. The real risk is cost: clean
  or LFS filters on `add -A` hitting the 15 s timeout (N6).
- **Prompt text:** only the validated run id and a fixed path are interpolated. OK.
- **Staged `init.lua` hunk:** only agent-review wiring and which-key entries. Clean.
- **Deployment:** `agent-review.ts` not stowed; `pi-diff-review` still the active gate. No
  `.pi/agent-review` directories (searched `~`, depth 5) and no `refs/agent-review` in `~/dotfiles`
  or `~/repos/*`, so the Verification list was never run. `post-run-verifier.ts` is already
  stowed, so its change is live but has no listener yet.

## Required next steps (v1)

1. Import `basename`; rename back only after this call's own successful claim; validate the full
   decision shape before any `rm` or ref deletion (N1, N3).
2. Cancel the fallback timer on `agent_start` and on extension input within a run (N2); fail closed
   on start-snapshot errors (N6).
3. Start a reviewed run for agent-review's own follow-up (N5).
4. Scan `decisions/` at startup; guard against concurrent `finish` calls (N6).
5. Neovim: `open({ record.base })`, `reset_base(true)`, validate `base`, resolve real root-relative
   paths from diffview buffers, don't trim the patch, strict UUID pattern (N4, N7, #9, #12).
6. Pass the planner-written contract tests in
   `pi/.pi/agent/extensions-available/agent-review/agent-review.integration.test.ts` without editing
   them, and move the extension there (see "Scope and contract for v1").
7. Reformat to one statement per line.
8. Keep the `.gitignore` edits out of these commits. Then follow the spec's stow order and run the
   Verification list.

Deferred to v2: override shortcut, 7-day ref prune, print-mode handling, multi-session guarantees
beyond claim-by-rename.
