---
status: draft
branch: spec/commit-funnel
---
# SPEC: commit-funnel, one checked entry point for agent commits

## Objective
Agents in worktree-isolated sessions keep breaking the commit rules that live only in prose: staging with `git add -A`, inlining messages that the worktree guard then refuses, committing on `main`, or committing in a checkout that is not their own. Turn those rules into an engineering control (llm-wiki `summaries/reddit-complex-git-claude-code`): one script that does the commit the right way or refuses with a message that says what to do instead.

Success: an agent in a `.claude/worktrees/<name>` session commits with `$HOME/dotfiles/scripts/commit-funnel -F <message-file> <path>...`, the guard does not refuse it, and a bare `git commit` from such a session is blocked with a pointer to the funnel.

### Decisions
- D1: Python 3, stdlib only, executable at `scripts/commit-funnel`, same shape as `scripts/floor-guard` (a `git()` helper over `subprocess`). The name has no standalone "git" word, so the guard's text scan does not trip on it.
- D2: Interface: `commit-funnel -F <message-file> <path>...`. No `-m`; the message always comes from a file, so prose never sits in a Bash argument.
- D3: Refusals (exit 2, one line saying what to do instead): the working directory is not inside a git work tree; HEAD is detached; the branch is `main` or `master`; no paths given; a path is `.`, `-A`, `--all` or resolves outside the work-tree root; the message file is missing or empty, or its first line is longer than 72 characters; something other than the listed paths is already staged.
- D4: On success it stages exactly the listed paths (`git add -- <paths>`, which also records deletions), commits with `git commit -F <message-file>`, and prints `<short-sha> <subject>`. Git failures exit 1 with git's stderr.
- D5: It commits only. Pushing stays a plain `git push`, already fenced by `settings.json` deny rules and the agent-review gate.
- D6: Enforcement: `claude/.claude/hooks/enforce-bash-safety.sh` blocks (exit 2) a Bash command in which any command segment (start of line, or after `;`, `&&`, `||` or `|`) is `git commit` or `/usr/bin/git commit` when the hook input `cwd` is under `*/.claude/worktrees/*`. The block message names the funnel and its usage. Outside worktrees nothing changes, so the human's own sessions are unaffected.

## Acceptance Criteria
- AC-1: In a temp repo on a feature branch, committing two listed files from a message file creates one commit that contains exactly those files, with the file's text as the message, and prints the short sha and subject
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_commits_listed_paths`
- AC-2: The funnel refuses with exit 2, and makes no commit, on `main`, on `master` and on a detached HEAD
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_protected_or_detached`
- AC-3: The funnel refuses with exit 2 when given no paths, `.`, `-A`, `--all`, or a path outside the work-tree root
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_bad_paths`
- AC-4: The funnel refuses with exit 2 for a missing message file, an empty one, and one whose first line exceeds 72 characters
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_bad_message`
- AC-5: When a file not in the path list is already staged, the funnel refuses with exit 2 and leaves the index unchanged
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_foreign_staged`
- AC-6: A listed path that was deleted from the work tree is committed as a deletion
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_commits_deletion`
- AC-7: The safety hook blocks `git commit -F x`, `/usr/bin/git commit -F x` and `cd a && git commit -F x` with exit 2 and a message naming `commit-funnel` when `cwd` is under `.claude/worktrees/`, and allows the same commands, plus `git status` and `git push origin feat` from a worktree, otherwise
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_hook_blocks_worktree_commit`
- AC-8: Existing script tests still pass
  verify: `cd scripts/tests && python3 -m unittest test_spec_loop test_post_commit_hook`
  baseline: pass
- AC-9: `docs/workflows/worktree-guard-bandaid.md` documents the funnel, its usage and the hook block, and `shared/research-tool-routing.md` points agent commits at it
  verify: `rg -q "commit-funnel" docs/workflows/worktree-guard-bandaid.md && rg -q "commit-funnel" shared/research-tool-routing.md`
- AC-10: Use-test: in a fresh worktree-isolated Claude Code session, a plain `git commit` is blocked with the funnel message, and `commit-funnel` then commits without a guard refusal
  verify: manual - needs a live Claude Code session with the merged hook

## Boundaries
### Always
- Tests build throwaway repos in a temp dir with a temp `HOME` and `GIT_CONFIG_NOSYSTEM=1`, like `test_spec_loop.py`; never touch the real repo or config
- Keep every existing `enforce-bash-safety.sh` block and its exit codes unchanged
- Run `~/dotfiles/scripts/ac-run check docs/SPEC-commit-funnel.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Adding push, amend, a commit mutex, or message templating to the funnel
- Blocking any git subcommand other than `commit`, or blocking outside `.claude/worktrees/`
- Changing `settings.json` permission rules
### Never
- Append attribution or rewrite the caller's message text
- Run `git add -A`, `git add .`, `--no-verify` or `--amend` inside the funnel
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- How should the funnel know which worktree is the session's own, so it can refuse a commit after `cd` into another checkout? Default: rely on D3's `main`/`master` refusal plus the guard; there is no reliable session-worktree variable to check against today.
- Should agents use the funnel or jj? `shared/research-tool-routing.md` says jj is the default VCS for agents, while the llm-wiki decision of 2026-10-20 says agents stay on git. Default: the funnel serves git commits; the hook does not touch `jj commit`. Resolve the jj/git rule conflict separately.
- Is a commit mutex needed (two agents in one worktree)? Default: no; each worktree has one agent, and git's `index.lock` already serializes.
