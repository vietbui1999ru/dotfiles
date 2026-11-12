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

The report prints to the terminal and is written to `~/lx-out/linux-check.txt`. Full output for
each failed test is written under `~/lx-out/linux-check-logs/<baseline|fixed>/`, one file per
test named from its path with `/` replaced by `_`. The folder is cleared at the start of a run,
so it never holds a previous run's failures. If `/out` is not writable, the logs are skipped,
and the report's failure section still shows the last 40 lines of each failed test.

The container installs Node 24 from NodeSource, so the run needs network access beyond
Ubuntu's own mirrors. If NodeSource cannot be reached, the run stops; it does not fall back to
Ubuntu's Node 18, which cannot load the tests.

The report opens with a summary: files fixed by the branches, regressions, files failing on
both trees, and skipped files. A file that fails on both trees is an environment or pre-existing
failure, not one caused by the branches. Skipped files (a missing `jj`, a helper that needs
arguments, or a pi-view test that needs the `pi-sandbox` Linux opt-in) never fail the run.
`scripts/tests/test_pi_view_provenance.py` and `scripts/tests/test_pi_view_secrets.py` are
skipped because they need `~/.config/pi-sandbox/linux-open`, which this check does not create.

The `tester` account carries the full name `linux-check`, and the tests run with
`EMAIL=linux-check@example.invalid`. Some tests build their environment from scratch and
discard `git config` as well as every `GIT_*` variable, so the identity has to come from the
account's full name plus `EMAIL`, which git reads for the default address.

After the branch merges, the script path becomes `/src/scripts/tests/linux-check.sh`.

Pass branch names to test a subset: `... linux-check.sh fix/lx-secret fix/lx-sync`.
