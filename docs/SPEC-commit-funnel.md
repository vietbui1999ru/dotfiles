---
status: approved
branch: spec/commit-funnel
---
# SPEC: commit-funnel, one checked entry point for agent commits

## Objective
Agents in worktree-isolated sessions keep breaking the commit rules that live only in prose: staging with `git add -A`, inlining messages that the worktree guard then refuses, committing on `main`, committing in a checkout that is not their own, or getting the multi-step jj protocol wrong. Turn those rules into an engineering control (llm-wiki `summaries/reddit-complex-git-claude-code`): one script that commits the right way, in git or colocated jj, or refuses with numbered steps that say exactly what to do.

Success: an agent in a `.claude/worktrees/<name>` session commits with `$HOME/dotfiles/scripts/commit-funnel --worktree <session-worktree> -F <message-file> <path>...`, the guard does not refuse it, and a bare `git commit` or `jj commit` from such a session is blocked with a pointer to the funnel.

### Decisions
- D1: Python 3, stdlib only, executable at `scripts/commit-funnel`, same shape as `scripts/floor-guard` (small `git()`/`jj()` helpers over `subprocess`, no shell). The name has no standalone "git" word, so the guard's text scan does not trip on it.
- D2: Interface: `commit-funnel [--worktree <path>] -F <message-file> <path>...`. No `-m`; the message always comes from a file, so prose never sits in a Bash argument. The funnel reads the file and hands its text to git or jj itself.
- D3: Refusals exit 2 and print a block that names where the funnel is (work-tree root and branch), where it was told the session lives, and numbered steps. Refusals:
  - not inside a work tree;
  - `--worktree` given and the work-tree root differs from it (the wrong-checkout case: the block says "you are in B, your session worktree is A, your changed paths are C", then steps: do not commit here, tell the user those three facts, wait for the user to move the changes, because touching B is outside the session's isolation);
  - branch is `main` or `master`;
  - no branch can be found (see D5);
  - no paths given; a path is `.`, `-A`, `--all` or resolves outside the work-tree root;
  - the message file is missing or empty, or its first line is longer than 72 characters;
  - git only: something other than the listed paths is already staged.
- D4: Git mode (no `.jj` directory at the work-tree root): `git add -- <paths>` (records deletions too), `git commit -F <message-file>`, print `<short-sha> <subject>`. HEAD must be on a branch.
- D5: jj mode (`.jj` directory at the work-tree root, colocated): the branch is the attached git branch if HEAD is attached, otherwise the single bookmark on `@-`; zero or several is a refusal that lists them. Then `jj --no-pager file track <paths>`, `jj --no-pager commit -m <message text> <paths>` (unlisted changes stay in the new `@`), `jj --no-pager bookmark move <branch> --to @-`, `git switch <branch>` so git-based tools (`ac-run`, `floor-guard`, `agent-review`) see the branch again. Print `<short-sha> <subject>` of `@-`.
- D6: It commits only. Pushing stays `git push` or `jj git push -b <branch>`, already fenced by `settings.json` deny rules and the agent-review gate.
- D7: Enforcement: `claude/.claude/hooks/enforce-bash-safety.sh` blocks (exit 2) a Bash command in which any command segment (start of line, or after `;`, `&&`, `||` or `|`) is `git commit`, `/usr/bin/git commit`, `jj commit` or `jj ci`, when the hook input `cwd` is under `*/.claude/worktrees/*`. The block message gives the funnel's exact usage. Outside worktrees nothing changes, so the human's own sessions are unaffected.
- D8: No commit mutex. One agent per worktree, git's `index.lock` already serializes commits, and jj merges concurrent operations. Revisit only if several agents share a worktree.

## Acceptance Criteria
- AC-1: In a temp git repo on a feature branch, committing two listed files from a message file creates one commit containing exactly those files, with the file's text as the message, and prints the short sha and subject
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_git_commits_listed_paths`
- AC-2: In git mode the funnel refuses with exit 2, and makes no commit, on `main`, on `master` and on a detached HEAD
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_git_refuses_protected_or_detached`
- AC-3: The funnel refuses with exit 2 when given no paths, `.`, `-A`, `--all`, or a path outside the work-tree root
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_bad_paths`
- AC-4: The funnel refuses with exit 2 for a missing message file, an empty one, and one whose first line exceeds 72 characters
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_bad_message`
- AC-5: In git mode, when a file not in the path list is already staged, the funnel refuses with exit 2 and leaves the index unchanged
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_git_refuses_foreign_staged`
- AC-6: A listed path that was deleted from the work tree is committed as a deletion
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_git_commits_deletion`
- AC-7: With `--worktree` pointing at a different directory than the work-tree root, the funnel refuses with exit 2, makes no commit, and its output contains the work-tree root, the `--worktree` path, the changed paths and numbered steps
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_refuses_wrong_checkout`
- AC-8: In a temp colocated jj repo with HEAD on a feature branch, the funnel commits only the listed paths, leaves an unlisted change in the new `@`, moves the branch bookmark to the new commit, and leaves git HEAD attached to that branch (the test fails, not skips, when `jj` is missing)
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_jj_commits_and_moves_bookmark`
- AC-9: In jj mode with git HEAD detached and no bookmark, or two bookmarks, on `@-`, the funnel refuses with exit 2 and lists what it found
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_jj_refuses_ambiguous_branch`
- AC-10: The safety hook blocks `git commit -F x`, `/usr/bin/git commit -F x`, `cd a && git commit -F x`, `jj commit -m x` and `jj ci -m x` with exit 2 and a message naming `commit-funnel` when `cwd` is under `.claude/worktrees/`; it allows the same commands outside worktrees, and allows `git status`, `git push origin feat` and `jj st` inside one
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel -k test_hook_blocks_worktree_commit`
- AC-11: Existing script tests still pass
  verify: `cd scripts/tests && python3 -m unittest test_spec_loop test_post_commit_hook`
  baseline: pass
- AC-12: `docs/workflows/worktree-guard-bandaid.md` documents the funnel, its usage, the wrong-checkout steps and the hook block; the "Git history" jj paragraph in `shared/research-tool-routing.md` and `shared/AGENTS.md` says agents commit through the funnel
  verify: `rg -q "commit-funnel" docs/workflows/worktree-guard-bandaid.md && rg -q "commit-funnel" shared/research-tool-routing.md && rg -q "commit-funnel" shared/AGENTS.md`
- AC-13: Use-test: in a fresh worktree-isolated Claude Code session, plain `git commit` and `jj commit` are blocked with the funnel message, and `commit-funnel` then commits (in jj mode, with the branch advanced) without a guard refusal
  verify: manual - needs a live Claude Code session with the merged hook

## Boundaries
### Always
- Tests build throwaway repos in a temp dir with a temp `HOME` and `GIT_CONFIG_NOSYSTEM=1`, like `test_spec_loop.py`; never touch the real repo or the user's jj or git config
- Pass `--no-pager` and `-m` to every jj call so nothing waits on an editor or pager
- Keep every existing `enforce-bash-safety.sh` block and its exit codes unchanged
- Run `~/dotfiles/scripts/ac-run check docs/SPEC-commit-funnel.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Adding push, amend, a commit mutex, or message templating to the funnel
- Blocking any git or jj subcommand other than `commit`/`ci`, or blocking outside `.claude/worktrees/`
- Changing `settings.json` permission rules
- Using jj workspaces instead of git worktrees
### Never
- Append attribution or rewrite the caller's message text
- Run `git add -A`, `git add .`, `--no-verify`, `--amend`, `jj squash`, `jj abandon` or `jj rebase` inside the funnel
- Touch a checkout other than the work-tree root it runs in
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- The wrong-checkout check needs the agent to pass `--worktree`. Without it, the funnel falls back to the `main`/`master` refusal plus the guard. Default: the docs and the hook's block message always show `--worktree`; making it required is a later change if agents skip it.
- jj support follows the colocated model the sources back (jj on top of git worktrees): llm-wiki research 2026-10-21 (panozzaj.com Nov 2025, geirsson.com 2026, claude-code#66503). The llm-wiki `entities/jujutsu` page still records the superseded 2026-10-20 "agents stay on git" decision (#132, replaced by #133); update it when this lands.
