# Plan Handoff

After plan approval, dispatch to Pi by default — do not implement directly. Direct implementation is an exception; state why.

Use `shared/skills/delegate-pi/SKILL.md`. Use delegate mode (async through `pueue`) for one task; use parallel delegate mode for independent tasks. Interactive work the human intends to watch goes through pane mode via `scripts/pane-handoff`, with the model asked for rather than assumed. Do not build new dispatch machinery.

Dispatch approved file-backed plans through `pi-dispatch`, one task per plan:

```bash
/Users/vietquocbui/dotfiles/scripts/pi-dispatch add --model <explicit-model> \
  --task-file <absolute-path-to-plan>.md --cwd <absolute-path-to-worktree>
```

Spell the command exactly like this: the literal absolute path, unquoted, as the whole Bash command. Claude's sandbox exempts `pi-dispatch` by that literal text only. `$HOME/...`, `~/...`, a relative path, an env prefix or a chained second command all leave it sandboxed, and the dispatch then fails on the pueue socket. pi-dispatch prints `task=<id> slug=<slug> model=<model>`.

pi-dispatch builds the pueue task: `pi-view --tui pi --model … --session-id pueue-<slug> -p "$(cat <task-file>)" < /dev/null`, run in `--cwd`. The task text is read inside the task, so it never sits in pueue's stored command. The slug, label and session id are generated fresh from the task file name for every dispatch. An approved plan is implementation, so it dispatches with the default `--mode tui`: from a herdr pane, the pane runs Pi's own interactive TUI on the plan, the person can steer and queue in it, and the task lasts until they quit Pi. Search, exploration, viewing and review dispatches pass `--mode view`, which only streams the transcript. Outside herdr both run as a plain dispatch. Every run goes through `pi-sandbox`.

`--cwd` must be an existing linked worktree at `<repo>/.claude/worktrees/<name>`, on a branch other than `main` or `master`: create it first (`jw new <branch>`) and run Pi inside it. agent-review snapshots only the run's working directory, so a Pi run started in the main checkout that edits a worktree it made itself leaves no review at all. Never ask Pi to create its own worktree. Set an explicit model (`--model`, which must be in Pi's `enabledModels`) or tier (`--tier high|medium|low`) per `model-routing.md`; never rely on defaults. The task file must be a regular file under 256 KiB inside the worktree, `~/.claude/plans` or `$TMPDIR`. From a Claude session, use the worktree or `~/.claude/plans`: pi-dispatch runs outside the sandbox with the person's own `$TMPDIR`, so the sandbox's temp folder is refused. Keep the worktree's branch name within 16 characters.

`pi-dispatch status`, `pi-dispatch log <id>` and `pi-dispatch wait <id>...` are the read-only views of the queue. `pueue kill`, `pueue clean` and `pi-queue` are the person's commands.

Keep these tasks in Claude:

- Debugging and root-cause work: each next step depends on the previous result, so async delegation loses the hypothesis chain.
- The review gate: `agent-review`, `post-run-verifier`, and `pi-lens`. Pi must not edit the gate that reviews Pi.

Never run `agent-review approve`: approving a Pi run is the person's decision, made with the confirmation dialog, not an agent's.

Pi handles everything else by default, including multi-file features, migrations, and refactors.

After dispatch, report the pueue task ID. Pi commits as it works; on collection, review its commits and revert what you reject. In `~/dotfiles`, use `:AgentReview` for the live review gate.

Claude may drive a nested Claude Code session for a live gate only inside a detached tmux session it creates, named claude-<purpose>, through tmux send-keys -t claude-… and tmux capture-pane. It never sends keys to any other tmux session, never answers a nested session's permission prompt beyond what the gate needs, and kills the session when the gate ends.

## Claude git: commit and push without asking

This section is for Claude only (Pi's rule in `shared/` still asks before push). After each coherent unit of work in a feature branch or git worktree, stage by path, commit, and push the branch (`git push` or `git push -u origin <branch>`), without asking. Before each push, squash fixup and WIP commits into the coherent commits they belong to with `jj squash`: pushed commits are immutable, so this is the last chance to consolidate. Open a draft PR when the work is ready for review. `settings.json` allows `git add`, `git commit` and `git push`, and denies force-push, `--delete` and pushes to `main`/`master`. For `jj`, the default VCS (protocol in the "Git history" section of `shared/research-tool-routing.md`), it allows only the subcommands that protocol uses (`st`/`status`, `log`, `diff`, `show`, `file track`/`list`, `commit`, `describe`, `new`, `squash`, `rebase`, `tug`, `bookmark`, `git init`/`fetch`/`push`, `op log`, `undo`/`op undo`); `squash` and `rebase` are for unpushed commits only, and the stowed jj config's `immutable_heads()` refuses pushed commits and `main`/`master`; other rewrites such as `abandon` prompt. It denies `jj util`, `--config`/`--config-file` and `config set`/`edit` (each can run an arbitrary program), jj pushes or bookmark moves on `main`/`master`, `--deleted`/`--all` pushes, `--ignore-immutable` and `op abandon`. For `mise` (protocol in "Repo tooling: mise" in the same file), it allows the read-only commands plus `install`, `run` and `x`/`exec`, and denies `trust`, global `use`, `settings`, `self-update`, `implode`, `token` and `ssh`. Still ask before merge, `git rebase` and `reset --hard`. A permission denial on a commit is not an invitation to work around it: report it.

send-it has its own rule file, `send-it.md`. Its rules apply only while send-it is on.
