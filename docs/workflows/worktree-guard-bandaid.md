# Worktree guard bandaid

Status: active since 2026-10-20. Applies to Claude Code 2.1.210 through at least 2.1.304, and rtk up to 1.0.1.

## Symptom

In a worktree-isolated Claude Code session (`EnterWorktree`, `isolation: "worktree"` subagents, background jobs), Bash calls fail with one of:

- "...this command names git in a form too complex to verify that it stays inside the worktree. Refusing to run it..."
- "...this command runs rtk with a git command among its operands..."
- "...this command runs a string through source, which can't be verified to stay inside the worktree..."
- "...this command points git at a directory computed at runtime (-C ~/…)..."

The guard is part of Claude Code. It cannot be turned off, and WorktreeCreate hooks do not bypass it (CHANGELOG 2.1.144).

## Causes

| Cause | Source | Status |
|---|---|---|
| The rtk PreToolUse hook rewrites `git X` to `rtk git X`, which the guard cannot verify | rtk-ai/rtk#3864 | Fixed by rtk PR #3879 (merged 2026-10-17), not in stable v1.0.1 |
| `~` is never expanded by the guard; `$HOME` is | anthropics/claude-code#88550 | Open |
| git aimed outside the session's worktree (`git -C`, `cd <main> &&`, `--git-dir`, `GIT_DIR`) | CHANGELOG 2.1.216 | By design |
| `source`, `.`, `eval` and other interpreter builtins | anthropics/claude-code#84530 | By design |
| Nested shell expansions, runtime-computed paths, the word "git" inside argument text | #84720, CHANGELOG 2.1.274 | Partly fixed in 2.1.257/2.1.259 |

Full evidence: llm-wiki `wiki/summaries/claude-code-worktree-guard-issues.md` and `wiki/concepts/claude-code-worktree-guard.md`.

## The bandaid

### Hook wrapper

`claude/.claude/hooks/rtk-hook-unless-worktree.sh` replaces `rtk hook claude` as the Bash PreToolUse hook in `claude/.claude/settings.json`. It reads the hook input, and when `cwd` is under `*/.claude/worktrees/*` it exits 0 without output, so no rewrite happens. Elsewhere it hands the input to `rtk hook claude` unchanged.

Side effects inside worktrees:

- No rtk output compression.
- No rtk auto-allow. `rtk hook claude` answers `"permissionDecision": "allow"` for the commands it rewrites, so those commands now go through the normal permission rules.
- `rtk` may report "No hook installed". Do not run `rtk init -g` to silence it: that reinstalls the bare hook and brings the refusals back.

After merging and pulling main, run `scripts/restow.sh` so `~/.claude/hooks/` gets the new link (it is a real directory with per-file links). Until then the hook command points at a missing file. `~/.claude/settings.json` is itself a stow link, so the settings change is live as soon as main has it.

### Rules for agent turns

1. Use `$HOME` or absolute paths, never `~`.
2. If a command still gets rewritten to `rtk git`, call `/usr/bin/git` instead. Never type `rtk git` or `rtk proxy git` yourself; those are refused even after the rtk fix.
3. Point git only at your own worktree. No `git -C`, `cd … &&`, `--git-dir` or `GIT_DIR` aimed at the main checkout or another worktree.
4. Do not use `source`, `.` or `eval`. Run helpers as `bash script.sh`.
5. Use literal paths. Avoid `cd $(…)` and paths held in variables in the same command that runs git.
6. Keep prose containing "git" out of arguments. Write commit messages and PR bodies to a file under `$CLAUDE_JOB_DIR/tmp` and pass it with `git commit -F` or `gh pr create --body-file`.
7. If a combined command is refused, write the files with the Write tool and run one plain command per call.
8. Never try to disable isolation. `ExitWorktree` with `keep`, followed by `cd` into the worktree, removes the guard but also the isolation; do it only with the user's explicit consent.

`&&`, pipes and redirects are fine on their own (#88550). Splitting a command does not help when the refused part is a `~` or a rewritten git call.

### Commit through the funnel

`scripts/commit-funnel` is the one checked way for an agent session to commit. From anywhere in the session worktree:

```sh
$HOME/dotfiles/scripts/commit-funnel --worktree /abs/path/of/session/worktree -F <message-file> <path>...
```

Spell the session worktree out literally, as the session announced it (for example `/Users/vietquocbui/dotfiles/.claude/worktrees/<name>`). Never pass `$PWD` or `.`: after a stray `cd` they name the wrong checkout and the check always passes.

The message always comes from a file (`-F`, never `-m`), so prose never sits in a Bash argument, and its first line must be 72 characters or fewer. The funnel stages and commits only the listed paths, and it prints `<short-sha> <subject>`. It never pushes, amends or rewrites the message.

It commits in one of two modes, chosen by the work-tree root:

- git mode (no `.jj` at the root): `git add -- <paths>`, then `git commit -F <file>`. Add records deletions too.
- jj mode (colocated, `.jj` present): `jj file track`, `jj commit -m '<message text>' <paths>`, `jj bookmark move <branch> --to @-`, then `git switch <branch>` so `ac-run`, `floor-guard` and `agent-review` read the branch again. Unlisted working-copy changes stay in the new `@`, and the funnel prints the sha and subject of `@-`.

It refuses with exit 2 and numbered steps, and commits nothing, when: no path is given; a path is `.`, `-A`, `--all` or resolves outside the work-tree root; the message file is missing, empty, or has a first line over 72 characters; the branch is `main` or `master`; no branch is unambiguous (detached HEAD in git mode, or detached HEAD with zero or several bookmarks on `@-` in jj mode); or, in git mode, a path outside the list is already staged.

`--worktree` is the check that you commit in your own checkout. When the work-tree root differs from it, the block says: you are in B, your session worktree is A, your changed paths are C. The steps are: do not commit here; tell the user those three facts; wait for the user to move the changes, because touching B is outside the session's isolation. Pass `--worktree` every time. It is optional, and without it only the `main`/`master` refusal and the hook stand between an agent and a commit in the wrong checkout.

The Bash PreToolUse hook (`enforce-bash-safety.sh`) closes the other half. When the hook `cwd` is under `*/.claude/worktrees/*`, a command segment that is `git commit`, `/usr/bin/git commit`, `jj commit` or `jj ci` exits 2 with a message naming `commit-funnel` and showing its usage. `git status`, `git push origin <branch>` and `jj st` pass, and outside a worktree the block does not apply, so the human's own sessions commit as before.

### Git-level guard: the reference-transaction hook

The Bash hook matches command text, so `bash -c`, `eval`, a script file or an odd spelling gets past it, and Pi has no Bash hook at all. `scripts/hooks/reference-transaction` closes that gap inside git. Git runs it for every ref update, so `--no-verify` does not skip it, and it also covers rebase, reset, cherry-pick, merge, `update-ref` and `branch -D`.

`scripts/link-git-hooks` (run by `scripts/bootstrap-dirs.sh`) links it into the common hooks directory next to `post-commit`. An existing non-link file is saved as `reference-transaction.bak`. Run it after merging, in the main `~/dotfiles` checkout:

```sh
$HOME/dotfiles/scripts/bootstrap-dirs.sh   # or: $HOME/dotfiles/scripts/link-git-hooks
```

What it does, inside a checkout whose top-level path contains `/.claude/worktrees/`:

- Refuses (exit 1, message on stderr naming `commit-funnel`) any update that moves or deletes an existing `refs/heads/*` branch. The check is whether the branch exists, not the old id git passes, because `update-ref <ref> <sha>` and `branch -f` pass the all-zero old id for an existing branch.
- Allows creating a new branch, and every non-branch ref: `HEAD`, tags, `refs/remotes/*`. `fetch`, `status` and `switch -c` work.
- Allows `git pack-refs`, which `gc` and auto-maintenance run: it moves refs from loose files into `packed-refs` without changing any branch's value, but its transactions look like a create and a delete of every branch. The hook recognises it by its parent process's git subcommand (after git's own options), so `update-ref -m pack-refs` is still refused.
- Allows everything in the main checkout, and in any repo outside `.claude/worktrees/`.
- `scripts/commit-funnel` sets `COMMIT_FUNNEL=1` only for its own `git commit` subprocess (git mode), which lets that one ref update through.

Threat model: this stops agents that commit by habit or by accident, through any spelling. It does not stop a same-user process that deliberately sets `COMMIT_FUNNEL=1`, deletes the hook, or sets `core.hooksPath`; nothing a same-user agent can reach can. The worktree-isolation guard and the agent-review gate remain the controls for that. The Bash hook blocks `COMMIT_FUNNEL=`, `AGENT_REF_GUARD=` and `core.hooksPath` in worktree commands so a Claude session does not learn to forge them.

Human override: for the human's own work inside an agent worktree, run `AGENT_REF_GUARD=off git <command>`. It makes the hook exit 0 for that command. Agents must not use it.

Known gap: jj bookmark moves do not run git hooks. jj writes refs through its own library, so `jj bookmark move` and jj's commit path are not covered. The Bash hook still blocks `jj commit`/`jj ci` for Claude, and Pi's rules say to use the funnel. A jj-native check needs jj's own hook support, which jj 0.46 does not offer.

## jj in worktree sessions

The guard treats `jj` as a launcher and refuses any command with `git` among its operands: `jj git init --colocate`, `jj git fetch` and `jj git push` are refused in every spelling, including with `-R <literal worktree>`. Every other jj command passes (`jj st`, `log`, `diff`, `new`, `describe`, `bookmark`, and the commit funnel).

- `claude/.claude/hooks/jj-colocate-worktree.sh` is a Bash PreToolUse hook. When the hook `cwd` is inside a `.claude/worktrees/*` checkout that has no `.jj`, it runs `jj git init --colocate` at the worktree root, once, silently. Hooks run outside the guard, so this covers `EnterWorktree`, `isolation: "worktree"` subagents, background jobs and worktrees a session creates with `git worktree add` and then enters. Test: `bash claude/.claude/hooks/tests/jj-colocate-worktree.test.sh`.
- Wire operations use git in Claude sessions: `git fetch` and `git push origin <branch>`. In a colocated repo jj imports git's ref changes on its next command, so nothing is lost. Local history work stays in jj.
- Pi has no guard and runs `jj git init --colocate`, `jj git fetch` and `jj git push -b <branch>` itself.

After merging, run `scripts/restow.sh` so `~/.claude/hooks/` gets the new link.

## Removal criteria

- A stable rtk release that contains PR #3879: delete `rtk-hook-unless-worktree.sh`, point `settings.json` back at `rtk hook claude`, and drop rule 2's first sentence.
- anthropics/claude-code#88550 closed: drop rule 1.
- Rules 3 and 4 follow the guard's design and stay.

Check with `rtk --version` against the rtk release notes, and `gh issue view 88550 --repo anthropics/claude-code`.
