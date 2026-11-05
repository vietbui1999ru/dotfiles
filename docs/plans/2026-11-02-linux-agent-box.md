# Linux agent box profile (multi-machine Phase 2)

Branch: `feat/linux-agent`, stacked on `worktree-portgrd` (PR #220). Parent plan: `~/.claude/plans/i-want-to-bring-tranquil-sunrise.md`, Phase 2.

## Goal

One command turns a fresh Debian-family box into a machine that runs the agent workflow:

    scripts/bootstrap-ubuntu.sh --agent        # WSL2 Ubuntu, homelab
    scripts/bootstrap-ubuntu.sh --agent-lite   # Raspberry Pi, arm64, 4 GB RAM

- **Full agent box:** dotfiles stowed (no GUI packages), mise tools, pueue, Pi, qmd, and `~/repos/llm-wiki` present.
- **Lite box:** the same, minus pueue, Pi and every source build (no cargo compiles). qmd is installed, but `qmd embed` never runs (keyword search only).

The existing macOS, `dev_debian`, `ubuntu_desktop` and `admin_redhat` plays must behave exactly as before.

## Boundaries

- Edit only `ansible/**`, `scripts/bootstrap-ubuntu.sh` and this plan's own follow-up notes. No changes to `claude/`, `zsh/`, `pi/`, `codex/` or the llm-wiki submodule.
- Never copy secrets. The secrets step only creates the directory and prints a reminder.
- Keep defaults backward compatible: every new variable defaults to today's behaviour.
- Never add an approval fallback. `ac-run approve` and `agent-review approve` stay Mac-only.

## Facts to rely on (from a scout pass; check before editing)

- `ansible/group_vars/all/roles.yml:2-15` defines `bootstrap_roles`, which every play in `ansible/site.yml` loops over.
- `ansible/roles/dotfiles/tasks/main.yml:38-52` stows a hardcoded list (zsh starship mise tmux kitty nvim git claude). kitty is unconditional. Lines 20-31 init the llm-wiki submodule, and lines 33-36 run `scripts/bootstrap-dirs.sh`, which already links `~/repos/llm-wiki` to the submodule. No new wiki role is needed.
- `ansible/roles/mise/tasks/main.yml` installs mise and runs `mise install`. `mise/.config/mise/config.toml` pins node (lts), bun, uv, bat, ripgrep, fd, delta, lazygit, jj, fzf, zoxide, rtk, jq and yq, all with arm64 builds.
- In `ansible/roles/tools/tasks/main.yml`, the GitHub tarball downloads are x86_64-only at l.92 (fzf), l.105 (ripgrep), l.186 and l.241 (lazygit). The cargo block at l.160-177 compiles eza, bat, delta, zoxide and jj. The arch-case pattern to reuse is at l.332-334.
- Molecule: `ansible/molecule/default/` uses the docker driver, with platforms debian12, ubuntu2604 and rockylinux9 and no agent group. `verify.yml:6-19` checks binaries. This Mac is arm64, so local molecule runs exercise arm64 natively.
- Pi pulls its packages (`npm:pi-lens`, `npm:context-mode`) itself from `pi/.pi/agent/settings.json`, so only Pi needs installing.

## Tasks (one commit each)

### 1. tools role: arm64-safe downloads

Give fzf, ripgrep and lazygit (Debian and RedHat blocks) an arch case like l.332-334:

| Tool | x86_64 asset | aarch64 asset |
|---|---|---|
| fzf | `linux_amd64` | `linux_arm64` |
| ripgrep | `x86_64-unknown-linux-musl` | `aarch64-unknown-linux-gnu` |
| lazygit | `Linux_x86_64` | `Linux_arm64` |

Confirm each asset name exists with `curl -fsIL <url>` for the pinned version before committing, and correct the table if one differs.

### 2. tools role: lite mode skips source builds

Add `agent_lite: false` to the tools role's defaults. When `agent_lite` is true:
- skip the cargo block (Debian l.160-177; RedHat does not need lite)
- install `eza` from apt (bat, delta, zoxide and jj already come from mise)

### 3. dotfiles role: configurable stow list

Replace the hardcoded loop list with `dotfiles_stow_packages`, defaulting to the current eight packages in the current order.

### 4. New `agents` role

Create `ansible/roles/agents/` (tasks + defaults). Linux only (`ansible_os_family != 'Darwin'`). It runs after `mise`, so node and npm come from mise (`mise x -- npm ...`, or mise shims on PATH).
- **pueue + pueued** (skip when `agent_lite`): download the latest GitHub release binaries for the host arch (`pueue-x86_64-unknown-linux-musl` / `pueue-aarch64-unknown-linux-musl`, and the same for `pueued`; check the names) into `~/.local/bin`, mode 0755. Don't install a service: the workflow starts pueued on dispatch. (Superseded 2026-11-03: pueued now runs as a systemd user service from the `systemd` stow package, enabled by the agents role.)
- **Pi** (skip when `agent_lite`): global npm install of `@earendil-works/pi-coding-agent`.
- **qmd** (always): global npm install of `@tobilu/qmd`. Register the llm-wiki collection the same way the Mac does: run `qmd --help` and `qmd collection list` on this Mac to get the exact commands and collection names, then mirror them. Run `qmd update` only. Never run `qmd embed` when `agent_lite` is true; on a full box, leave `qmd embed` to the user and say so in a debug message.
- **Secrets:** ensure `~/secrets` exists with mode 0700, and print a debug reminder that `~/secrets/.env` and `~/.pi/agent/auth.json` must be copied by hand.
- Make every task idempotent: use `creates:` or a version check, so a second run reports `changed=0`.

### 5. agent_linux play and group vars

- Add an `agent_linux` play to `ansible/site.yml`, modelled on the `ubuntu_desktop` play.
- Add `ansible/group_vars/agent_linux.yml`:
  - `bootstrap_roles`: the default list minus `kitty` and `ruby`, plus `agents` after `mise`. When `agent_lite` is true, also drop `rust`.
  - `dotfiles_stow_packages`: `zsh starship mise tmux tmuxinator nvim git jj claude pi opencode`. No kitty. No `codex`, whose hooks still hold `/Users/` paths.
- Add `ansible/inventory/local-agent.yml` (group `agent_linux`, host `agent-local`, `ansible_connection: local`), modelled on `inventory/local-ubuntu.yml`.

### 6. bootstrap script

In `scripts/bootstrap-ubuntu.sh`:
- Accept any Debian-family OS: `ID` is ubuntu or debian, or `ID_LIKE` contains debian. Raspberry Pi OS and Debian homelab boxes need this.
- Keep the 26.04 warning for Ubuntu only.
- Add `--agent` (inventory `local-agent.yml`, `--limit agent_linux`) and `--agent-lite` (the same, plus `-e agent_lite=true`).
- With no flag, behave exactly as today.
- Fix the usage comment at l.9: `--tags dotfiles` matches no tag. Replace it with a working example.

### 7. Molecule coverage

In `ansible/molecule/default/molecule.yml`, add two platforms:
- `ubuntu2604-agent` (`docker.io/library/ubuntu:26.04`, groups `debian` and `agent_linux`)
- `debian12-lite` (`debian:12-slim`, groups `debian` and `agent_linux`, host var `agent_lite: true`)

In `verify.yml`:
- on `agent_linux` hosts, assert that `qmd`, `rtk`, `jj` and `stow` resolve, and that no kitty link exists in `~`
- when not lite, also assert `pi` and `pueue`
- when lite, assert `pi` and `pueue` are absent

Leave existing platforms and assertions alone.

## Verification

Run from the repo root and paste the output:

    yamllint ansible/ && ansible-lint ansible/
    bash -n scripts/bootstrap-ubuntu.sh && shellcheck scripts/bootstrap-ubuntu.sh
    docker info >/dev/null 2>&1 && (cd ansible && molecule test -p ubuntu2604-agent && molecule test -p debian12-lite && molecule test -p ubuntu2604)

If docker is not running, say so and skip the molecule line. Do not claim it passed. Run the old `ubuntu2604` platform too, to prove the existing profile still converges. Stop after three failed fix attempts on any command, and report the exact failing output.

## Out of scope (note in the final report)

- llm-wiki's post-commit hook runs `qmd embed`. On a lite box, that hook would download about 2 GB of models; fixing it belongs to llm-wiki.
- The codex hooks and the cloud setup script (Phase 3).

## Commits

One commit per task, staged by path through `$HOME/dotfiles/scripts/commit-funnel --worktree /Users/vietquocbui/dotfiles/.claude/worktrees/portgrd`. Use Conventional Commits, e.g. `feat(ansible): add agents role for pueue, Pi and qmd`.
