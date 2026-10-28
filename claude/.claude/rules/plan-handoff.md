# Plan Handoff

After plan approval, dispatch to Pi by default — do not implement directly. Direct implementation is an exception; state why.

Use `shared/skills/delegate-pi/SKILL.md`. Use delegate mode (async through `pueue`) for one task; use parallel delegate mode for independent tasks. Interactive work the human intends to watch goes through pane mode via `scripts/pane-handoff`, with the model asked for rather than assumed. Do not build new dispatch machinery.

Dispatch approved file-backed plans through `pueue`, one task per plan:

```bash
SLUG="<plan-name>-$(openssl rand -hex 2)"
TASK_ID=$(pueue add -i --print-task-id --label "$SLUG" -w <absolute-path-to-worktree> -- \
  "$HOME/dotfiles/scripts/pi-view --tui pi --model <explicit-model> --session-id pueue-$SLUG -p \"\$(cat <absolute-path-to-plan>.md)\" < /dev/null")
```

`scripts/pi-view` goes in front of `pi` on every dispatch. An approved plan is implementation, so it dispatches with `--tui`: from a herdr pane, the pane runs Pi's own interactive TUI on the plan, the person can steer and queue in it, and the task lasts until they quit Pi. Search, exploration, viewing and review dispatches use plain `pi-view`, which only streams the transcript. Outside herdr both run as a plain dispatch.

`-w <worktree>` (a pueue flag, before `--`) is required: create the worktree first and run Pi inside it. agent-review snapshots only the run's working directory, so a Pi run started in the main checkout that edits a worktree it made itself leaves no review at all. Never ask Pi to create its own worktree. `< /dev/null` is required. Set an explicit model tier per `model-routing.md`; never rely on defaults. `--label` (a pueue flag, before `--`) and `--session-id pueue-<slug>` (a pi flag) are required: the session-band mod finds the task's Pi session by that id. `<slug>` is the plan name, at most 11 characters, in lowercase `[a-z0-9-]` plus a fresh 4-hex suffix: 16 characters at most, new for every dispatch. The worktree's branch name stays within 16 characters too. `pi --session-id` resumes an existing session with that id, so a reused slug silently continues an old conversation.

The `\"\$(cat)\"` escaping matters: unescaped, the plan text is pasted into the stored command when the task is added.

Keep these tasks in Claude:

- Debugging and root-cause work: each next step depends on the previous result, so async delegation loses the hypothesis chain.
- The review gate: `agent-review`, `post-run-verifier`, and `pi-lens`. Pi must not edit the gate that reviews Pi.

Never run `agent-review approve`: approving a Pi run is the person's decision, made with the confirmation dialog, not an agent's.

Pi handles everything else by default, including multi-file features, migrations, and refactors.

After dispatch, report the pueue task ID. Pi commits as it works; on collection, review its commits and revert what you reject. In `~/dotfiles`, use `:AgentReview` for the live review gate.

Claude may drive a nested Claude Code session for a live gate only inside a detached tmux session it creates, named claude-<purpose>, through tmux send-keys -t claude-… and tmux capture-pane. It never sends keys to any other tmux session, never answers a nested session's permission prompt beyond what the gate needs, and kills the session when the gate ends.

## Claude git: commit and push without asking

This section is for Claude only (Pi's rule in `shared/` still asks before push). After each coherent unit of work in a feature branch or git worktree, stage by path, commit, and push the branch (`git push` or `git push -u origin <branch>`), without asking. Open a draft PR when the work is ready for review. `settings.json` allows `git add`, `git commit` and `git push`, and denies force-push, `--delete` and pushes to `main`/`master`. For `jj`, the default VCS (protocol in the "Git history" section of `shared/research-tool-routing.md`), it allows only the subcommands that protocol uses (`st`/`status`, `log`, `diff`, `show`, `file track`/`list`, `commit`, `describe`, `new`, `squash`, `rebase`, `tug`, `bookmark`, `git init`/`fetch`/`push`, `op log`, `undo`/`op undo`); `squash` and `rebase` are for unpushed commits only, and the stowed jj config's `immutable_heads()` refuses pushed commits and `main`/`master`; other rewrites such as `abandon` prompt. It denies `jj util`, `--config`/`--config-file` and `config set`/`edit` (each can run an arbitrary program), jj pushes or bookmark moves on `main`/`master`, `--deleted`/`--all` pushes, `--ignore-immutable` and `op abandon`. For `mise` (protocol in "Repo tooling: mise" in the same file), it allows the read-only commands plus `install`, `run` and `x`/`exec`, and denies `trust`, global `use`, `settings`, `self-update`, `implode`, `token` and `ssh`. Still ask before merge, `git rebase` and `reset --hard`. A permission denial on a commit is not an invitation to work around it: report it.

send-it has its own rule file, `send-it.md`. Its rules apply only while send-it is on.
