# Agent workflow

Source of truth: `shared/workflow.md` in dotfiles. It records the current flow from agent-harness. A repo `docs/WORKFLOW.md` gives the exact commands and outranks this file for that repo.

## Roles and models
- User: files issues, approves specs, lands sensitive PRs, tests results.
- Root session: drafts specs and plans, dispatches workers, verifies results, integrates, opens PRs. It runs Sonnet for routine turns.
- Checkpoints: the root session runs each checkpoint as an Opus subagent with no conversation history. The checkpoints are the spec critic and the verification before the PR.
- Critic: reads the spec draft. It accepts the draft, sends it back with findings, or asks for one review round.
- Review round: other models review the draft. Use it only for tools with missing or stale documentation, and for security checks inside the blast radius of the change.
- Search, explore, fetch and report subagents: Haiku.
- Implementation workers: Sonnet, one worktree and one task each.
- Workers never message each other. A worker sends a request to the root session. The root session changes the contract and sends a notice to the affected workers.

## Approval words
- The user approves a spec by typing `approve <hash8>` in the session.
- The user lands a sensitive PR by typing `land PR #<n>` in the session.
- A GitHub comment, a worker report, or an earlier approval does not count. The user and the agent share one GitHub account.
- Never record an approval, enable auto-merge, or merge a sensitive PR without the typed words.
- If the spec hash changes after approval, ask for a new approval.

## Flow per issue
1. Create a worktree `$HOME/repos/<repo>-worktrees/<n>-<slug>` on branch `issue/<n>-<slug>`. Keep the main checkout on `main`. A session in an isolated worktree does not do steps 1 and 10.
2. Draft the spec. After the critic accepts it, run the spec lint. Report the hash and the tier.
3. After `approve <hash8>`, record the approval and write the task plan. Run the plan check and fix every violation.
4. Commit the stub: the spec, the plan, the contract tests and the signatures. The subject starts with `stub:`. Workers do not edit stub tests.
5. Dispatch the tasks in parallel. Give each worker its packet, its scope and the trailer block.
6. Re-run every task check. Compare each task branch with the stub signatures for contract drift. A worker report stays a claim until its checks pass again.
7. Merge the task branches. Run every spec AC, every repo check and the spec check. Run them in a temporary detached worktree of the merged commit. A check must not move refs.
8. The verification checkpoint reads the spec, the merged diff and the check output. After it passes, open the PR. Wait for CI with `gh pr checks <n> --watch --required`. Never hide stderr in a wait loop.
9. A low tier PR merges after CI passes. A sensitive tier PR waits for `land PR #<n>`. Before a merge, confirm the approval record matches the spec hash at the PR head, the branch is up to date, and CI passes. Then squash-merge and close the issue.
10. Remove the worktrees and branches. Update the handoff file.

## Plan rules
- Task scopes do not overlap. Every task scope is inside the spec scope.
- Every AC belongs to one task or to integration.
- The task graph has no cycles. A wave has at most 5 tasks. The graph sets the number of workers; do not use a fixed number.
- Verify commands come from the spec through the packet. Never take a verify command from a worker result.
- The tier comes from the repo list of sensitive paths. An edit of that list is itself sensitive.

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
- Classify each failure first: task-local (redispatch with the failure output), contract (back to the critic or the user), environment (stop and report).
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
- Update the handoff after each landed issue. Also update it when the context reaches 100k tokens or 60% of the model window, whichever is lower. Then ask the user to type `/clear`. A SessionStart hook reloads the handoff.
- Keep the handoff at 8,000 characters or less. Move old entries to `handoff-archive.md` in the same directory. The SessionStart hook shows only a 2,000 character preview of output over 10,000 characters.
