# jj workspaces for agent sessions: plan

Status: approved 2026-11-09. M1 and M2 done, M3 and M4 in progress. Branch `feat/jj-ws`. Written against jj 0.46 and Claude Code 2.1.319.

## Goal

Stop the refusals agents hit in worktrees, and give parallel checkouts one shared jj store. Both interactive sessions and background jobs use the new path; background jobs are the bulk of the work.

## What the evidence says

The original brief blamed git locks. The evidence does not support that.

| Finding | Evidence |
|---|---|
| Locks are not the problem | 269 transcripts over 14 days: 1 with a ref-lock error, 0 with `index.lock`. Four parallel writers on git worktrees: 100/100 commits, 0 failures |
| The built-in guard is the problem | 550 real refusals in 87 transcripts. Counted as tool results that start with the guard message; 578 lines mention it, so quoting inflates the raw count by about 5% |
| The guard follows session state, not location | A plain `claude -p` and a plain `claude --bg` started inside `.claude/worktrees/<x>` both ran `jj git remote list`, which the guard refuses in isolated sessions. All 6 refused sessions sampled carry a persisted worktree-session marker; the unguarded probe has none |
| jj alone does not remove refusals | The top reasons are about command shape: too-complex git forms (141), computed values in `rg` (72), `rtk git` rewrites (41), git aimed at the shared checkout (52) |
| A `--colocate` workspace is a real git worktree | `git worktree list` shows it, and `EnterWorktree` accepts it |
| The funnel's reattach works there | `jj commit`, `jj bookmark move`, `git switch <branch>` leaves HEAD attached, and `git worktree list` shows the branch. Two workspaces share bookmarks and the primary stays on `main` |
| Trust | `claude --bg` refuses an untrusted directory. `jj-ws` has no trust entry of its own and ran, because its main repo is trusted, or so it appears |

Limits of this evidence: the background-job probe ran one command once, and all location tests used a checkout under `.claude/worktrees/`. A checkout elsewhere is untested, so the plan does not move the location. Milestone 2 is the live test.

## Design

The refusals go away because of how a session starts, so the change is mostly a launcher.

`.claude/worktrees/<name>` stays the location. Background jobs treat a directory there as already isolated, so they need no `EnterWorktree`, and that call is what sets the guard. A new helper creates a colocated jj workspace there on a real branch, and sessions launch inside it.

HEAD stays attached to the branch, as the funnel already arranges. This reverses an earlier proposal to treat detached HEAD as normal and adapt the tools. Staying attached means `spec`, `floor-guard`, `focus` (`worktree_of` at `scripts/focus:220` matches `branch refs/heads/<x>`), `pi-checks` and `agent-review` all work unchanged.

Trade-off: one branch cannot be checked out in two workspaces, because `git switch` refuses. That is rarely needed, and it is far cheaper than changing five tools.

Trade-off the user accepted with the hybrid choice: sessions started this way lose the built-in guard's stop on touching the shared checkout. Milestone 3 restores the part of it that matters.

## Keep, strip, replace

| Piece | Action | Why |
|---|---|---|
| `scripts/jw` (new) | Add | One way to create and remove workspaces |
| `scripts/commit-funnel` including the reattach | Keep | It is what keeps the git-based tools working, and it carries provenance |
| `spec`, `floor-guard`, `pi-checks`, `focus`, `agent-review` | Keep unchanged | HEAD stays attached |
| `scripts/hooks/reference-transaction` | Keep | With the built-in guard gone from these sessions, it matters more |
| `enforce-bash-safety.sh` commit and override blocks | Keep | Independent of the guard |
| `enforce-bash-safety.sh` | Extend | Block git aimed at the primary checkout (milestone 3) |
| `jj-colocate-worktree.sh` | Keep | Still needed by `isolation: "worktree"` subagents. It is a no-op on a `jw` workspace, because `.jj` already exists |
| `rtk-hook-unless-worktree.sh`, `log-worktree-guard.sh` | Keep | Guarded sessions remain; existing removal criteria still apply |
| `settings.json:489` stale worktree path | Fix | Names a removed worktree (`ubuntu-2604-bootstrap`) |
| `scripts/focus:511` `REDIRECT` | Fix | Matches `>` inside quotes and misreads a read-only command as a write |
| Guard docs and agent rules | Rewrite | They say background jobs are always guarded, which is false for this launch path |

The strip list is short on purpose. Most wrappers do a job that jj does not replace. Replacing them would add risk and remove few refusals.

## Milestones

Milestone 1 and the later ones go to Pi as separate dispatches, with milestone 2 between them in Claude.

### M1: the helper (Pi)

`scripts/jw`, bash-compatible, runnable from any checkout of the repo. It finds the primary checkout from `git rev-parse --git-common-dir`.

`jw new <branch>`:

1. Refuse `main`, `master`, a branch over 16 characters, or an existing target directory. The name is the branch without its type prefix (`feat/jj-ws` becomes `jj-ws`).
2. In the primary checkout: `git fetch origin main`, then `jj workspace add --colocate --name <name> -r main@origin .claude/worktrees/<name>`.
3. In the new workspace: `jj bookmark create <branch> -r @-`, then `git switch <branch>`.
4. Print the absolute path.

`jw rm <name>`: refuse if the workspace has uncommitted changes. Gitignored content is handled before removal: known caches (`__pycache__/` at any depth and `.ruff_cache/`) are deleted, and known agent records (`.pi/`, `.serena/`, `.pi-lens-probe-home/`, `.agents/events.jsonl` and `.agents/sessions/`) are moved to `${XDG_STATE_HOME:-$HOME/.local/state}/jw-archive/<repo>/<name>-<YYYYMMDD-HHMMSS>/`, keeping their relative paths. The archive also holds a `jw-meta.txt` with the branch, HEAD commit and date. Any other gitignored entry makes `jw rm` refuse and name it. Archives older than 14 days are pruned after a successful removal. To inspect one, read it from that folder, for example `.pi/agent-review/decisions` for the approved Pi runs. Then run `jj workspace forget <name>`, confirm the directory and the `git worktree list` entry are gone, and remove the worktree without `--force` if not. Never delete the branch.

Zsh functions next to the existing aliases in `zsh/.zsh/`, so the interactive `claude` wrapper still injects MCP keys:

- `jwc <branch>`: `jw new` if needed, `cd`, start `claude`.
- `jwb <branch> <prompt>`: `jw new` if needed, then in a subshell `cd` and `claude --bg "$prompt"`, so the caller's directory does not change.

Tests in `scripts/jw.test.sh`, against a throwaway repo with a local bare remote. Cover: HEAD attached after `new`; `git worktree list` shows the branch; each refusal in step 1; `rm` refuses a dirty workspace; `rm` cleans both jj and git; primary stays on `main`; a funnel commit in the workspace moves the branch.

Stop after M1 and report. Do not start M3.

### M2: live gate (Claude, not Pi)

Pi cannot launch Claude Code, and this decides whether the rest is worth doing. Before any hook changes:

1. `jwb` a throwaway branch in `~/dotfiles`. Confirm it starts with no trust prompt. `claude --bg` fails outright if not.
2. In that job, run one command of each refused shape: a nested-expansion git command, `rg` with a computed value, `git -C` at the primary, and `jj git fetch`.
3. Confirm none is refused, that the job can write files, and that the funnel commits.
4. `git status` and `git branch --show-current` in the primary: still clean, still `main`.
5. Clean up with `jw rm`. Never `claude rm`, which can delete the worktree.

If the guard fires, stop. The fallback is the keep-all-isolation option, with `jw` kept for the shared store only.

**Result, 2026-11-09: passed.** A real `claude --bg` job in a fresh `jw` workspace started with no trust prompt and no guard refusal for any shape: nested git expansion, computed `rg` value, `git -C` at the primary (literal and `~`), and `jj git fetch`. The funnel committed in the workspace with HEAD on its branch. The primary stayed on `main` with its status unchanged, and `jw rm` removed the jj workspace, git worktree and directory.

Three things the gate showed:

- An unattended job can stall on a "Blast-radius check" prompt for a command it "can't analyze". Both complex shapes did this, and the job waited as `blocked` until answered. Its source was not found in the plugins or dotfiles searched, and it is unknown whether guarded sessions see it. Open question: whether jobs should stop on it.
- The focus guard refuses writes in a workspace that is not a focus item. This is correct, and it means a `jwb` job on a new branch is read-only unless that branch holds a focus slot.
- The job read the primary checkout freely, which confirms M3 is needed.

### M3: restore the shared-checkout stop and fix `jw rm` (Pi)

`scripts/jw`, `jw rm`, two review findings from M1. Add the tests first, in `scripts/jw.test.sh`:

1. Refuse a name containing `/` or `..`, before anything else happens.
2. Stop using `rm -rf` on the workspace. Before `jj workspace forget`, list gitignored content with `git status --porcelain --ignored`, excluding `.jj`. If there is any (for example `.pi/agent-review` state or `node_modules`), refuse, name the entries and change nothing, so the human decides. After the forget, remove only the leftover `.jj` directory and then `rmdir` the workspace, so anything unexpected makes it fail loudly.

In `enforce-bash-safety.sh`, alongside the block at lines 158-166: when the hook `cwd` is under `*/.claude/worktrees/*`, refuse a git or jj command aimed at the primary checkout (`-C`, `-R`, `--git-dir`, `GIT_DIR=`, `cd <primary> &&`). Message: what was refused and that the session works only in its own workspace. Reuse `SEG`, `ASSIGN`, `WRAP` and `OPTS`.

This matches command text, so it stops habit and accident, not a deliberate bypass, the same threat model as the commit block. Add cases to `claude/.claude/hooks/tests/enforce-bash-safety.test.sh` first. Allow git aimed at the session's own workspace.

### M4: fixes and docs (Pi)

1. `settings.json:489`: replace the stale path with the repo's description, without naming a worktree.
2. `scripts/focus`: make `REDIRECT` ignore `>` inside quotes. Add the test to `scripts/tests/test_focus_hooks.py`.
3. `docs/workflows/worktree-guard-bandaid.md`: state that the guard is session state, not location; drop "background jobs" as always guarded in the Symptom section; add `jw` to the jj section.
4. `shared/research-tool-routing.md` and `shared/AGENTS.md`: new sessions start through `jw`, and in those sessions `jj git fetch` and `jj git push` work. Keep the guard rules for isolated sessions. Do not touch the Spec loop block; both copies of it stay identical.

## Verification

- `bash scripts/jw.test.sh`
- `bash claude/.claude/hooks/tests/enforce-bash-safety.test.sh`
- `bash claude/.claude/hooks/tests/jj-colocate-worktree.test.sh`
- M2's live checks, repeated once after M3 to confirm the new hook refuses `git -C` at the primary and allows a normal session.
- After merge, `scripts/restow.sh`, since new hook and zsh content must be linked.

## Boundaries

- Do not touch `agent-review`, `post-run-verifier` or pi-lens; those are the gate that reviews Pi.
- Do not edit existing worktrees or convert them. `jw` applies to new work only.
- Do not add a `WorktreeCreate` hook. It could put `EnterWorktree` and subagent checkouts in the shared store, but it is unverified and nothing here needs it. Worth a later look.
- Never run mutating jj commands in `~/dotfiles` other than `jw`'s `workspace add` and `workspace forget`: stow depends on that checkout staying on `main`.
