# Making the agent workflow work on Linux

After you pull the dotfiles on a Linux machine, the agent workflow runs, but not in exactly
the same shape as on the Mac. This page is the setup step and an honest list of what is
weaker there. It is not a port guide; it describes the behaviour the merged scripts have on
2026-11-12.

## 1. What differs on Linux

| Area | Mac | Linux |
| --- | --- | --- |
| Claude's Bash sandbox | Seatbelt, on | bubblewrap, on |
| `~/.claude/settings.json` | stow link to the repo file | a rendered file (`scripts/claude-settings-render`) |
| Pi sandbox | Seatbelt (`scripts/pi-sandbox.sb`), on | none; Pi runs unsandboxed behind an opt-in file |
| Approving a Pi run | a dialog an agent cannot click | `agent-review approve` asks nothing (section 4) |
| PR or MR listing at session start | `gh` for GitHub | `gh` for GitHub, `glab` for anything else |

`scripts/sync-status` picks `gh` or `glab` from the `origin` URL, not from the system. The
Mac row shows the usual case.

## 2. Setup after a pull

1. Render the Claude settings from the repo file:

   ```sh
   ~/dotfiles/scripts/claude-settings-render
   ```

2. Create the Pi opt-in. Only the person creates this file; an agent must not write it.

   ```sh
   mkdir -p -m700 ~/.config/pi-sandbox
   ( umask 077; printf 'unsandboxed-ok %s\n' "$(hostname -s)" > ~/.config/pi-sandbox/linux-open )
   ```

3. Restart Claude, so it reads the rendered settings.

4. Smoke test a dispatch:

   ```sh
   printf 'Report the current git branch.\n' > /tmp/pi-task.txt
   ~/dotfiles/scripts/pi-dispatch add --mode view --tier low --task-file /tmp/pi-task.txt
   ```

   It prints a line starting `pi-dispatch task=`. That `task=` is the queue id.

## 3. Keeping the rendered settings current

At session start `scripts/sync-status` runs the generator in check mode. When the live file
is stale it prints one line:

```text
claude-settings: /home/<you>/.claude/settings.json is stale or hand-edited; run ~/dotfiles/scripts/claude-settings-render
```

Rerun the generator to fix it. The generator records the hash of the file it wrote. If the
live file no longer matches that hash, the file was edited by hand (by `/model`, for
example), so the generator refuses and prints a unified diff:

```sh
~/dotfiles/scripts/claude-settings-render --force
```

`--force` overwrites the file and keeps the previous contents as `settings.json.prev`.

## 4. What is weaker on Linux

- **Pi can write anywhere you can.** There is no sandbox around it on Linux, so it can write
  `~/dotfiles`, `~/.claude` and the opt-in file itself. Only the written rules stop it.
- **The review gate is advisory.** `scripts/agent-review` skips the approval dialog on
  Linux: its `confirm` function prints a notice and returns true. An agent with a shell can
  therefore approve its own Pi run. Together with the point above, the gate is a rule, not a
  barrier.
- **Remove the opt-in when the sandbox lands.** Delete `~/.config/pi-sandbox/linux-open`
  once a bubblewrap port of `scripts/pi-sandbox` exists; until then `pi-sandbox` refuses to
  run Pi without it.

## 5. Mask files in worktrees

Claude's Linux sandbox binds empty character devices over protected names inside each
checkout. Git sees them as new files, so every status is dirty.

Fix it per repository, in `.git/info/exclude`. That file covers every worktree of the
repository. Use root-anchored entries so a name matches only at the repository root.

Always mask these:

```sh
cd <repo>
for name in .bashrc .bash_profile .zshrc .zprofile .profile .ripgreprc; do
  grep -qxF "/$name" .git/info/exclude || printf '/%s\n' "$name" >> .git/info/exclude
done
```

Mask the rest only when the repository does not track them:

```sh
for name in .gitmodules .gitconfig .mcp.json .vscode .idea; do
  [ -z "$(git ls-files -- "$name")" ] || continue
  grep -qxF "/$name" .git/info/exclude || printf '/%s\n' "$name" >> .git/info/exclude
done
```

Do not use a global gitignore. An unanchored `.zshrc` there would also hide `zsh/.zshrc` in
the dotfiles repository itself. Take the real list from `git status` on your box; the names
above are the common ones.

## 6. Not fixable from this repository

- Claude Code's built-in worktree guard refuses some commands it cannot parse:
  - a command that contains "git" inside a hostname,
  - `export VAR=...`,
  - variable targets for `cd` or `git -C`.

  Work around it with literal paths, a per-command prefix instead of `export`, or a script
  file.
- `$CLAUDE_JOB_DIR/tmp` is not writable. Use `$TMPDIR`.
- Without `~/repos/Obsidian/Focus.md` there is no focus board, so the focus guard allows
  everything.

## 7. Checking a change without the box

To test a change on Linux without the machine, see `docs/workflows/linux-check.md`; it
lands with `fix/lx-verify`.

## What was tested

Tested in an `ubuntu:24.04` container only, on 2026-11-12, by
`scripts/tests/linux-check.sh`:

- the stow step skips `settings.json`,
- `claude-settings-render` renders, is idempotent, and refuses a hand-edited file,
- `secret-get` mode checks,
- `pi-sandbox` refuses without the opt-in and runs with it,
- `scripts/pi-dispatch.test.mjs` passes.

Not tested anywhere: the real Linux box, `pi-dispatch` end to end with `pueue`, `glab`
output, Claude's bubblewrap sandbox, and everything in sections 5 and 6.
