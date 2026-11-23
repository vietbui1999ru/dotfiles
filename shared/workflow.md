# Agent workflow

Source of truth: `shared/workflow.md` in dotfiles. It records the current flow from agent-harness. A repo `docs/WORKFLOW.md` gives the exact commands and outranks this file for that repo.

## Roles and models
- User: files issues, approves specs, lands sensitive PRs, tests results.
- Root session (Opus): drafts specs and plans, dispatches workers, verifies results, integrates, opens PRs. It keeps design and review work.
- Search, explore, fetch and report subagents: Haiku.
- Implementation workers: Sonnet, one worktree and one task each.
- Workers never message each other. They report to the root session.

## Approval words
- The user approves a spec by typing `approve <hash8>` in the session.
- The user lands a sensitive PR by typing `land PR #<n>` in the session.
- A GitHub comment, a worker report, or an earlier approval does not count. The user and the agent share one GitHub account.
- Never record an approval, enable auto-merge, or merge a sensitive PR without the typed words.
- If the spec hash changes after approval, ask for a new approval.

## Flow per issue
1. Create a worktree `$HOME/repos/<repo>-worktrees/<n>-<slug>` on branch `issue/<n>-<slug>`. Keep the main checkout on `main`. A session in an isolated worktree does not do steps 1 and 10.
2. Draft the spec. Run the spec lint. Report the hash and the tier.
3. After `approve <hash8>`, record the approval and write the task plan. Run the plan check.
4. Commit the stub: the spec, the plan, the contract tests and the signatures. Workers do not edit stub tests.
5. Dispatch the tasks in parallel. Give each worker its packet, its scope and the trailer block.
6. Re-run every task check. A worker report stays a claim until its checks pass again.
7. Merge the task branches. Run every repo check and the spec check before the PR.
8. Open the PR. Wait for CI with `gh pr checks <n> --watch --required`. Never hide stderr in a wait loop.
9. On `land PR #<n>`: confirm the approval record matches, the PR head matches, the branch is up to date, and CI passes. Then squash-merge.
10. Remove the worktrees and branches. Update the handoff file.

## Git in an isolated worktree
Claude Code guards a session that entered a worktree through `EnterWorktree`, `isolation: "worktree"` or a background job. The guard refuses git that it cannot prove stays in that worktree. Obey these rules in such a session:
- Run git only from the session worktree directory. Do not use `git -C`, `cd <path> &&`, `--git-dir` or `GIT_DIR`.
- Write paths with `$HOME` or as absolute paths. The guard does not expand `~`.
- Use literal paths. Do not put git in a loop, in a `$(...)` substitution, or next to path variables.
- Do not use `source`, `.` or `eval`. Run a script as `bash <script>`.
- Write commit messages and PR bodies to a file. Pass the file with `git commit -F` or `gh pr create --body-file`.
- Do not create, enter or remove another worktree. To report other branches, use only the `git worktree list` and `git branch -vv` output.
- If the guard refuses a command, run one plain git command per call. If it refuses again, stop and report the message. Do not use `ExitWorktree` to get past the guard.

## Limits
- A task gets at most 3 retries. A spec gets at most 2 integration fixes. After that, the user decides.
- Classify each failure first: task-local (redispatch), contract (back to the planner or the user), environment (stop and report).
- If a worker needs a change outside its scope, the worker stops and reports. The root session makes the fix as an `integrate:` commit.
- If a tool permission is denied to a worker, do not do that action another way. Ask the user.

## Commits
- On an approved issue, commits on its branches are part of the work. Elsewhere, commit or push only when asked.
- Task commits carry `Task-Id`, `Spec-Hash` and `Agent` trailers.
- If you remove or rewrite a test, record it in the repo list of removed tests.

## Safety
- Read secret key names only. Never read, print, copy or commit a secret value. Use fake secrets in tests.
- Ask first before you delete anything in dotfiles or llm-wiki, or lower a minimum test count.
- Only the user edits network and allowlist files.

## Context
- One root session handles all issues. The handoff file is `$HOME/.local/state/harness/root/handoff.md`.
- Update the handoff after each landed issue and at about 70% of the context window. Then ask the user to type `/clear`.
