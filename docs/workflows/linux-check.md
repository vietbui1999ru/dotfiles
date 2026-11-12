# Linux check for the lx fixes

`scripts/tests/linux-check.sh` runs the agent scripts' test set on Linux inside a fresh
`ubuntu:24.04` container, before and after the seven `fix/lx-*` branches. The baseline is
`main`; the fixed tree is a throwaway `lx-all` branch merged from the requested branches.

## What it proves

- The test set (node, python, shell) passes on Linux for `main`, and what the lx fixes
  change in that result.
- Each extra check: `stow` leaves `.claude/settings.json` to the renderer,
  `claude-settings-render` is idempotent and refuses a hand edit, `secret-get` enforces
  700/600 modes, `pi-sandbox` refuses on Linux without the opt-in and runs with it, and
  `pi-dispatch add` queues a task when pueue is present.
- A merge conflict between the branches stops the run and names the branch.

## What it does not prove

- Claude's own sandbox: bubblewrap exemptions and mask files are not exercised.
- The real pueue socket and daemon in your session (the check starts its own `pueued`
  only when pueue is already installed in the container).
- `glab`, and a real Pi run with API keys.

## Run it

Start podman yourself; an agent session cannot.

```bash
podman machine start
mkdir -p ~/lx-out
git -C ~/dotfiles bundle create ~/lx-out/dotfiles.bundle --branches
podman run --rm -v ~/dotfiles:/src:ro -v ~/lx-out:/out ubuntu:24.04 \
  bash /src/.claude/worktrees/lx-verify/scripts/tests/linux-check.sh
```

The bundle step comes first because the Mac repository sets a git extension (`relativeWorktrees`)
that Ubuntu's git cannot read, so the container clones from the bundle instead of `/src`.
Recreate the bundle after new commits; the script refuses with the command if it is missing.

The report prints to the terminal and is written to `~/lx-out/linux-check.txt`.

After the branch merges, the script path becomes `/src/scripts/tests/linux-check.sh`.

Pass branch names to test a subset: `... linux-check.sh fix/lx-secret fix/lx-sync`.
