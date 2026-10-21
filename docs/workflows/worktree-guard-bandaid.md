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
$HOME/dotfiles/scripts/commit-funnel --worktree "$PWD" -F <message-file> <path>...
```

The message always comes from a file (`-F`, never `-m`), so prose never sits in a Bash argument, and its first line must be 72 characters or fewer. The funnel stages and commits only the listed paths, and it prints `<short-sha> <subject>`. It never pushes, amends or rewrites the message.

It commits in one of two modes, chosen by the work-tree root:

- git mode (no `.jj` at the root): `git add -- <paths>`, then `git commit -F <file>`. Add records deletions too.
- jj mode (colocated, `.jj` present): `jj file track`, `jj commit -m '<message text>' <paths>`, `jj bookmark move <branch> --to @-`, then `git switch <branch>` so `ac-run`, `floor-guard` and `agent-review` read the branch again. Unlisted working-copy changes stay in the new `@`, and the funnel prints the sha and subject of `@-`.

It refuses with exit 2 and numbered steps, and commits nothing, when: no path is given; a path is `.`, `-A`, `--all` or resolves outside the work-tree root; the message file is missing, empty, or has a first line over 72 characters; the branch is `main` or `master`; no branch is unambiguous (detached HEAD in git mode, or detached HEAD with zero or several bookmarks on `@-` in jj mode); or, in git mode, a path outside the list is already staged.

`--worktree` is the check that you commit in your own checkout. When the work-tree root differs from it, the block says: you are in B, your session worktree is A, your changed paths are C. The steps are: do not commit here; tell the user those three facts; wait for the user to move the changes, because touching B is outside the session's isolation. Pass `--worktree` every time. It is optional, and without it only the `main`/`master` refusal and the hook stand between an agent and a commit in the wrong checkout.

The Bash PreToolUse hook (`enforce-bash-safety.sh`) closes the other half. When the hook `cwd` is under `*/.claude/worktrees/*`, a command segment that is `git commit`, `/usr/bin/git commit`, `jj commit` or `jj ci` exits 2 with a message naming `commit-funnel` and showing its usage. `git status`, `git push origin <branch>` and `jj st` pass, and outside a worktree the block does not apply, so the human's own sessions commit as before.

## Removal criteria

- A stable rtk release that contains PR #3879: delete `rtk-hook-unless-worktree.sh`, point `settings.json` back at `rtk hook claude`, and drop rule 2's first sentence.
- anthropics/claude-code#88550 closed: drop rule 1.
- Rules 3 and 4 follow the guard's design and stay.

Check with `rtk --version` against the rtk release notes, and `gh issue view 88550 --repo anthropics/claude-code`.
