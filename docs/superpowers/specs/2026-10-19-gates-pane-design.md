# Gates pane: approve specs and Pi reviews from one place

Date: 2026-10-19. Status: approved 2026-10-19.

## Intent

Two human gates sit in the agent workflow:

- **Spec approval** (`scripts/ac-run approve SPEC.md`). A human approves a spec's acceptance criteria before an agent implements against them.
- **Pi run review** (`scripts/agent-review`, `:AgentReview` in Neovim, the `/pi` pane's Approve button). A human accepts or rejects a finished Pi run.

The review gate is quick to work with. `:AgentReview` finds the oldest pending review across every worktree of the repo, and the `/pi` pane has an Approve button.

The spec gate is slow. `ac-run` has no discovery: it takes a spec path and refuses unless the current branch equals the spec's `branch:`. So approving means finding the right worktree among many long-named ones, `cd`-ing into it, and typing the command. The approval records live in `~/.local/state/ac-run/` under a hash, so nothing maps them back to a worktree, and nothing lists specs across worktrees.

The guard itself is also weak. `ac-run approve` reads its `y` from stdin, so `echo y | ac-run approve SPEC.md` approves with no human. Only the rule "agents never run approve" stops an agent. `agent-review approve` instead asks in a macOS dialog an agent cannot click ("No bypass by design", `scripts/agent-review` `confirm()`).

This design gives both gates one place to look and one kind of guard.

## Goals

1. A **Gates pane** in the session-band mod lists every worktree of the current repo that has a spec or a pending Pi review, with each spec's state. Nobody types a worktree path.
2. From the pane, the person can **Approve**, **Reject** or **Edit** a spec, and **Approve**, **Open review** or **Reject all** a pending Pi review.
3. **One guard for both gates: a macOS dialog** an agent cannot click. `ac-run approve` stops reading stdin and asks through the same kind of dialog `agent-review` uses. The pane's Approve button leads to that dialog; the button is the convenient path, and the dialog is the guard.

## Non-goals

- Blocking merges mechanically. Today no hook refuses `gh pr ready`, push or merge for either gate; "unlocked for merge" is a convention agents follow. That stays as it is here. A merge-blocking hook would be a separate design.
- Replacing Neovim AgentReview. Reading a Pi run's diff and leaving notes stays in Neovim. The pane only shows pending reviews and decides them, as the `/pi` pane already does.
- Changing `agent-review`'s guard, records or CLI.
- Listing worktrees of other repos.

## Anti-goals (a failure even if it works)

- Any path by which an agent approves a spec or a review without a person clicking the dialog. That includes an environment variable, flag, config file or stdin answer that skips the dialog. Tests must not add such a seam either; see Testing.
- The person having to type or copy a worktree path, branch name or spec path to approve.
- A second, divergent copy of how spec state is computed. The pane asks `ac-run`; it does not reimplement the record hash.

## What is decided

### Spec discovery

For each worktree of the current repo (from `git worktree list --porcelain`, as `worktrees.ts` already parses), a spec is:

- `SPEC.md` at the worktree root, and
- each `specs/*.md` file,

in both cases only when the file's front matter `branch:` equals that worktree's current branch. PR #120 moved its spec to `specs/pueue-lifecycle.md`, so root-only discovery would already miss one. The branch filter applies to root `SPEC.md` too (my call). `ac-run` refuses a spec off its branch, and the main checkout's `SPEC.md` today names `feat/design-brief`, so an unfiltered root spec would show as a permanent error. A spec is approved on the worktree that has its branch checked out, which is where the pane lists it.

A worktree with no matching spec and no pending review is not listed. A detached worktree lists no specs.

### Spec state

The pane runs `~/dotfiles/scripts/ac-run status <spec>` with the worktree as the working directory. It always uses that stow-linked copy, the path the spec-loop rules already name (my call), so every row is judged by one version of `ac-run`. The approval hash uses the spec's repo-relative path, branch and AC lines, not the script's location, so records stay consistent.

It shows **draft**, **approved** or **stale** (the spec changed since approval), from the first word `ac-run` prints. Exit 0 means approved, and exit 3 means draft or stale. Any other exit is **invalid** (my call): `load()` raises a usage error for lint failures, an unreadable file or a branch mismatch, and the row shows the first line of stderr, with Approve disabled. The pane does not parse lint rules itself.

### Pi reviews in the same list

Review records are stored per worktree: `scripts/agent-review` uses the current checkout's top level, and `nvim/.config/nvim/lua/custom/agent_review.lua` scans every worktree for that reason. So the pane reads `<worktree>/.pi/agent-review/pending/*.json` for each worktree, via the existing `parsePending` in `session-band-plugin/hooks/review.ts`, and lists each record under the worktree it was found in.

Approve, Open review and Reject all reuse the `/pi` pane's behaviour (`approve`, `openReview`, `rejectAll` in `pane.tsx`), with the worktree as the working directory. Approve runs `scripts/agent-review approve <runId>`, which shows its own dialog and refuses if the tree changed. The others send keys to the person's Neovim. Reject all keeps its confirm-on-second-press.

### Spec actions

- **Before approving**, the selected spec row's detail shows every AC with its full verify command, the way `ac-run approve` prints them. So the person reads the whole list in the pane, even though the dialog shows a shortened one (my call).
- **Approve** runs `ac-run approve <spec>` with the worktree as the working directory. `ac-run` shows the dialog. While it runs, the row says "approving…": the dialog waits for the person, then the baseline runs every verify command. Pressing Approve again on that row does nothing until the run ends. The process call's timeout is generous: the dialog timeout plus `ac-run`'s own `--timeout` per command times the number of commands. Afterwards the row shows ac-run's last line ("approved: …", "not approved", or the refusal) and refreshes the state.
- **Reject** runs `ac-run reject <spec>`, after a second press to confirm, like `/pi`'s Reject all. Reject removes an approval and sets `status: draft`; it needs no dialog, because withdrawing approval is always safe.
- **Edit** (my call; the person did not specify) opens the spec file in the person's running Neovim, using the same socket lookup as `openReview` (`socketFor`, `reviewRemoteArgv` in `pane.tsx`) with `:edit <absolute spec path>`. If no Neovim is found, it falls back the way `openReview` does. Editing a `verify:` or `baseline:` line voids an approval by design, and the state column shows **stale** after the next refresh.

### The dialog in `ac-run approve`

`ac-run approve` no longer reads stdin. It still prints the same summary to stdout. It then asks through `/usr/bin/osascript` (absolute path), following `agent-review`'s `confirm()`:

- A title of `ac-run`, and buttons Cancel and Approve, with Cancel the default and the cancel button.
- It gives up after a timeout, which counts as Cancel.
- The message names the spec (path relative to the repo), the branch and the number of ACs. It lists the verify commands, truncated to fit (dialogs are small; show the first ~10 commands and "+N more"). It also says plainly that approving runs these commands on this machine now, for a baseline (my call).

Only an "Approve" reply proceeds. A failure to run osascript (no GUI session, not macOS) means not approved, with a message saying approval needs the macOS dialog. There is no terminal fallback.

The human-only line `ac-run lint` prints today ("HUMAN ONLY …: ac-run approve SPEC.md") is updated to point at the Gates pane first, with the command as the alternative.

### Pane placement and wiring

- New pane id `gates`, title `Gates`, opened by a `/gates` command. It is added to `MOD_PANES` and `PANE_TITLES` in `pane-nav.ts`, so `b`/`f` cycle to it (this depends on the pane-switching fix in PR #128).
- The key bar follows the worktrees pane's idiom (`flexWrap`, `columnGap={2}`): `j`/`k` to move, `a` approve, `x` reject (Reject on a spec row, Reject all on a review row, both confirmed by a second press), `e` edit (spec rows), `o` open review (review rows), `r` refresh, `b`/`f` prev/next, `q` close. Every key the pane uses is bound as a Button hotkey, because unbound keys fall through to the composer.
- One row per spec or review, grouped under a worktree header (the branch name, shortened the way the worktrees pane does). The state is coloured from `PALETTE`.
- It refreshes when opened, on `r`, and after each action. There is no timer.

### Code shape

- Pure parsing (worktree list, spec front matter `branch:`, `ac-run status` output, building the row model) goes in a new `gates.ts`, with tests. Process calls and rendering go in `gates.tsx`. The engine does not let `$` cross an import, so each `.tsx` runs its own process calls.
- `ac-run` changes stay in `scripts/ac-run` and its tests in `scripts/tests/test_spec_loop.py`.

## Constraints

- The spec-loop rules stay true: agents never run `ac-run approve`. The builder must not run it against a real spec while building or testing, and must not edit any existing spec's `verify:` lines.
- The session-band plugin tests run with `claude plugin test .` in `session-band-plugin/`.
- An honest limit: an agent with a shell could still write an approval record file by hand, as it could today. The dialog closes the scripted-`y` route, and the convention covers the rest. This design does not claim more than that.

## Testing

- `gates.ts` parsers: unit tests with fixture text for `git worktree list --porcelain`, spec front matter and each `ac-run status` answer.
- `gates.tsx`: kit tests in the style of `draft-prs-pane.test.ts`, with `$.process.run` answered by hooks. Check the rows, the states, and that Approve, Reject and Edit run the expected argv with the expected working directory.
- `ac-run approve`: tests replace the Python `confirm` function in-process (monkeypatching), never through an environment variable, flag or PATH stub. Cover Approve, Cancel, timeout and osascript failure, and check that stdin is no longer read (`echo y |` must not approve).
- Live: open `/gates` in a nested session with two worktrees holding draft specs, approve one through the dialog, reject it, and edit it.

## Left to the builder

- Exact row text and truncation, within the worktrees pane's style.
- How long the dialog waits before giving up, and how the message is truncated.
- Whether the `status` calls for many worktrees run in parallel.
- Whether the shared dialog code is copied into `ac-run` or extracted next to `agent-review`. Two small copies are acceptable.
