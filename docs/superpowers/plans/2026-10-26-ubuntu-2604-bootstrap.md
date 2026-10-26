# Ubuntu 26.04 bootstrap: on-box script and playbook fixes — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Do the tasks in order and commit after each one.

**Owner: Pi.** Work only in the files listed under each task.

**Goal:** A fresh Ubuntu 26.04 LTS desktop can be bootstrapped two ways with the existing `ubuntu_desktop` play in `ansible/site.yml`:
1. on the box itself, with one script and no GitHub SSH key;
2. over SSH from the Mac, as today.

**Source decisions:** owner session, 2026-10-26.
- The target is Ubuntu 26.04 LTS (codename `resolute`).
- Both run modes are supported.
- Extend the existing Ansible setup; do not write a separate installer.

## Findings this plan is based on

These were checked against Launchpad's published binaries for `resolute/amd64` and by reading the roles.

- All 48 apt package names in `ansible/roles/*/tasks/*.yml` exist in 26.04 except two:
  - `libncurses5-dev` (`ansible/roles/ruby/tasks/main.yml:14`)
  - `libncursesw5-dev` (`ansible/roles/python/tasks/main.yml:11`)

  Both are replaced by `libncurses-dev`, which also exists in Debian 12, so the molecule Debian platform keeps working.
- The `gh` apt source (`ansible/roles/tools/tasks/main.yml`, task "Add GitHub CLI apt repository (Debian)") writes `arch={{ ansible_architecture }}`. On x86_64 that renders `x86_64`, but apt expects the dpkg name `amd64`, so apt ignores the source and `gh` is not installed from it.
- `ansible/roles/dotfiles/tasks/main.yml` clones `git@github.com:vietbui1999ru/dotfiles.git`, and `.gitmodules` points `repos/llm-wiki` at `git@github.com:...`. A fresh box has no SSH key. Both repos are public, so HTTPS works without a key.
- Ubuntu 26.04 ships `ansible` 13.1.0, which bundles `community.general`, and `ansible-core` 2.20.1.
- There is no on-box entry point. The `localhost` play in `site.yml` is the macOS play, so a local Ubuntu host must **not** be named `localhost`, or it would also run the macOS play.
- Molecule tests only `debian:12-slim` and `rockylinux:9-minimal`. `prepare.yml` targets group `debian`.

## Global constraints

- Keep the SSH route from the Mac working unchanged. Its default transport stays SSH.
- Do not change the user's global git config. Rewrite URLs per command only (`git -c url...insteadOf=...`).
- Do not add roles, and do not touch `ansible/roles/github-ssh`, `node` or `secrets` (they are empty and out of scope).
- Do not change the stow package list.
- Lint clean: `ansible-lint` with the repo's `.ansible-lint`, and `shellcheck` for the new script.

## Task 1: 26.04 package names

**Files:** `ansible/roles/ruby/tasks/main.yml`, `ansible/roles/python/tasks/main.yml`

- [ ] Replace `libncurses5-dev` (ruby) and `libncursesw5-dev` (python) with `libncurses-dev`. If both lists end up listing `libncurses-dev`, that is fine; do not merge the roles.
- [ ] Commit: `fix(ansible): use libncurses-dev, gone 5-dev names fail on Ubuntu 26.04`

## Task 2: gh apt source architecture

**Files:** `ansible/roles/tools/tasks/main.yml`

- [ ] In "Add GitHub CLI apt repository (Debian)", render the dpkg architecture instead of `ansible_architecture`:
  `arch={{ {'x86_64': 'amd64', 'aarch64': 'arm64'}[ansible_architecture] | default(ansible_architecture) }}`
- [ ] Commit: `fix(ansible): gh apt source needs the dpkg arch (amd64), not x86_64`

## Task 3: HTTPS transport for the dotfiles clone

**Files:** `ansible/roles/dotfiles/defaults/main.yml`, `ansible/roles/dotfiles/tasks/main.yml`

- [ ] Add a default `dotfiles_git_transport: ssh` (values `ssh` or `https`).
- [ ] "Clone dotfiles repo": use `https://github.com/vietbui1999ru/dotfiles.git` when the transport is `https`, and the current SSH URL otherwise.
- [ ] "Init and update git submodules": when the transport is `https`, run
  `git -c url.https://github.com/.insteadOf=git@github.com: submodule update --init --recursive`.
  Otherwise keep the current command.
- [ ] Commit: `feat(ansible): dotfiles_git_transport=https clones without an SSH key`

## Task 4: on-box entry point

**Files (new):** `ansible/inventory/local-ubuntu.yml`, `scripts/bootstrap-ubuntu.sh`

- [ ] `ansible/inventory/local-ubuntu.yml`: group `ubuntu_desktop` with one host named `ubuntu-local`, `ansible_connection: local`, `ansible_python_interpreter: /usr/bin/python3`. No `ansible_user` or SSH key vars.
- [ ] `scripts/bootstrap-ubuntu.sh` (bash, `set -euo pipefail`, executable). It is safe to rerun.
  1. Read `/etc/os-release`. Exit with a message unless `ID=ubuntu`. Warn, but continue, if `VERSION_ID` is not `26.04`.
  2. `sudo apt-get update` and `sudo apt-get install -y git ansible python3-apt`.
  3. If `~/dotfiles` does not exist, clone `https://github.com/vietbui1999ru/dotfiles.git` there. If it exists, leave it as is (no pull).
  4. `cd ~/dotfiles`, so the repo's `ansible.cfg` sets `roles_path`.
  5. Run `ansible-playbook -i ansible/inventory/local-ubuntu.yml ansible/site.yml --limit ubuntu_desktop --ask-become-pass -e dotfiles_git_transport=https "$@"`, passing extra arguments through (for example `--check` or `--tags`).
- [ ] Commit: `feat(ansible): bootstrap-ubuntu.sh runs the ubuntu_desktop play on the box`

## Task 5: molecule platform for Ubuntu 26.04

**Files:** `ansible/molecule/default/molecule.yml`

- [ ] Add a platform `ubuntu2604` with image `docker.io/library/ubuntu:26.04`, `command: sleep infinity`, `pre_build_image: false`, group `debian`, matching the `debian12` entry.
- [ ] Commit: `test(ansible): molecule converges on Ubuntu 26.04`

## Task 6: README

**Files:** `README.md`, section "## Ansible (Linux / new machine)"

- [ ] Add the two Ubuntu desktop routes:
  - On the box: `curl -fsSL https://raw.githubusercontent.com/vietbui1999ru/dotfiles/main/scripts/bootstrap-ubuntu.sh | bash`, or clone first and run `scripts/bootstrap-ubuntu.sh`.
  - From the Mac: `ansible-playbook ansible/site.yml --limit ubuntu_desktop -i ansible/inventory/hosts.yml -K`.
- [ ] State that the on-box route clones over HTTPS, so the remote stays HTTPS. Switch it with `git remote set-url origin git@github.com:vietbui1999ru/dotfiles.git` once an SSH key is added.
- [ ] Commit: `docs(readme): Ubuntu 26.04 bootstrap routes`

## Verification

Run from the repo root and paste each output in the final report.

- `ANSIBLE_ROLES_PATH=ansible/roles ansible-playbook --syntax-check ansible/site.yml`
- `ansible-playbook -i ansible/inventory/local-ubuntu.yml ansible/site.yml --limit ubuntu_desktop --list-hosts`. It must list only `ubuntu-local`, and the macOS `localhost` play must match no hosts.
- `ansible-lint ansible/`
- `shellcheck scripts/bootstrap-ubuntu.sh`
- `rg -n 'libncurses5-dev|libncursesw5-dev' ansible` returns nothing.
- Molecule needs Docker. If the Docker daemon is not running, say so and skip it; do not start Docker. If it is running: `cd ansible/molecule/default && molecule test -p ubuntu2604`.

Not covered here; the owner does this: a real run on the Ubuntu 26.04 box.
