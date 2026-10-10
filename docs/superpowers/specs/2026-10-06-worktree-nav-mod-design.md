# worktree-nav mod: design spec (grilled, not yet built)

Status: design decisions settled with the user on 2026-10-06. Nothing is implemented. Build after `session-band` is finished (see `claude-just-updated-to-tingly-ember.md`).

> Provenance (2026-10-10): copied unchanged from `~/.claude/plans/worktree-nav-mod-spec.md`, a Claude plan-mode scratch directory outside any repo, so the spec is not lost. `claude-just-updated-to-tingly-ember.md` is another file in that scratch directory and is not in the repo; the session-band design it pointed at is `docs/superpowers/specs/2026-10-06-session-band-mod-design.md`, and the session-band hand-off work is in `docs/superpowers/plans/2026-10-10-session-band-pi-handoff.md`.

## What it is

A pane inside Claude Code (terminal surface only) that lists git worktrees, branches and commit history, navigated with vim keys, and opens a new Claude session in the selected worktree. Opened with a `/wt` slash command.

## Decisions

1. Attach means a new session. Enter opens a new `claude` process in the chosen worktree. The current session is never moved (no `EnterWorktree`, no `/cd`), because a live session's context, CLAUDE.md, hooks and state files all refer to the old checkout.
2. Spawn through herdr. Use a herdr pane split with `--cwd <worktree>` running plain `claude`. Plain `claude` with no model or permission-mode copying. An optional second key may run `claude --continue`.
3. A branch with no worktree gets one created after a confirm, at `.claude/worktrees/<branch-slug>`. The mod never runs `git switch` in an existing checkout. Remote branches are out of scope.
4. A worktree with a live Claude or Pi session is marked in the list. Enter focuses the existing pane instead of spawning a second one. A separate key forces a second session behind a warning.
5. Actions beyond browse, open and create: remove worktree, delete merged branch, commit detail view.
6. Guardrails for remove and delete. Hard refusal with no override for: the main worktree, the current or default branch, a worktree with a live session, uncommitted changes, or commits not merged and not on a remote. Otherwise the user must type the branch or directory name to confirm. Branch deletion is `git branch -d` only, never `-D`, and nothing uses `--force`.
7. Layout: three columns (Worktrees, Branches, History), switched with h/l or Tab; stacked below about 120 columns. History follows the selected worktree or branch. Keys: j/k move, gg/G ends, `/` filter, Enter open (context-sensitive), `o` commit detail, `d` remove or delete, `c` create worktree, `r` refresh, `q` or Esc close.

## New facts that change the implementation

- herdr (the workspace manager used by `scripts/pane-handoff`) has `herdr worktree list|create|open|remove`, `herdr pane split --cwd`, `herdr agent list|focus` and `herdr pane process-info`. Prefer these over hand-rolled git and process scanning: `worktree create/open` for decision 3, `agent list/focus` for decision 4. Branches and history still come from `git branch` and `git log` through `$.process.run`.
- herdr's own `worktree remove` safety behaviour is unknown. The mod must apply decision 6's refusals itself before calling it, and must not rely on herdr to refuse.
- The mod API has no way to change a session's cwd, which is consistent with decision 1.
- Keys: a `Client` element receives `ClientKeyEvent` (`key`, `ctrl`, `shift`), so vim keys are possible. Keys only reach a pane while it has focus; Esc returns to the prompt.
- A hook has a 10 second budget, so every herdr and git call must be a `$` call (not counted) and listings must be cached in `$.state`, refreshed on open and on `r`.

## Risks and open questions

- Verify herdr's JSON output format for `worktree list` and `agent list` (flags such as `--json`), and how an agent pane reports its cwd. Needed for occupancy marks.
- Typed-confirm needs an `Input` element inside the pane; confirm focus behaviour with `ui.input` and that vim keys do not leak into the field.
- Branch names with slashes (`feature/x`) need a slug rule and collision handling at `.claude/worktrees/`. Confirm that directory is gitignored in the repo.
- Prunable or missing worktrees (directory deleted by hand) must show as such and be removable with `git worktree prune`, not crash the listing.
- History size: page `git log` (for example 200 rows) and page commit diffs; `Code` with `format: 'diff'` is refused when a diff is cut mid-hunk, so cut on hunk boundaries.
- Deleting a worktree the current session sits in must be refused (the session's own cwd).
- Decide whether `/wt` lives in its own mod or inside `session-band`. Recommendation: its own mod, `worktree-nav`, so it can be installed and disabled separately.

## Build order

1. `git.ts` list and parse functions plus tests (worktrees, branches, log), pure parsing separated from process calls.
2. Pane with column navigation and state, read-only.
3. Open and create via herdr.
4. Occupancy marks and focus-existing.
5. Commit detail view.
6. Remove and delete with guardrails and typed confirm, with tests for every hard refusal.
