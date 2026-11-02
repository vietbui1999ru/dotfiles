#!/usr/bin/env bash
# Bootstrap a Debian-family box from the box itself: one script, no GitHub SSH
# key, no second machine. Clones the dotfiles repo over HTTPS and runs a play
# locally. Safe to rerun: an existing ~/dotfiles is left alone and the play is
# idempotent.
#
# Plays:
#   (default)       ubuntu_desktop: the Ubuntu desktop PC (GUI packages included)
#   --agent         agent_linux: a headless agent box (WSL2, homelab)
#   --agent-lite    agent_linux, lite: a Raspberry Pi class box (no pueue, Pi or
#                   source builds; qmd keyword search only)
#
# Usage: scripts/bootstrap-ubuntu.sh [--agent | --agent-lite] [extra ansible-playbook args]
#   scripts/bootstrap-ubuntu.sh --check
#   scripts/bootstrap-ubuntu.sh --tags tools
#   scripts/bootstrap-ubuntu.sh --agent --check
set -euo pipefail

readonly REPO_URL=https://github.com/vietbui1999ru/dotfiles.git
readonly TARGET_VERSION=26.04
readonly DOTFILES_DIR="$HOME/dotfiles"

die() {
  printf 'bootstrap-ubuntu: %s\n' "$*" >&2
  exit 1
}

# Pick the play first: --agent and --agent-lite are ours; everything else is
# passed through to ansible-playbook.
inventory=ansible/inventory/local-ubuntu.yml
limit=ubuntu_desktop
extra_vars=()
passthrough=()
for arg in "$@"; do
  case "$arg" in
    --agent)
      inventory=ansible/inventory/local-agent.yml
      limit=agent_linux
      ;;
    --agent-lite)
      inventory=ansible/inventory/local-agent.yml
      limit=agent_linux
      extra_vars=(-e agent_lite=true)
      ;;
    *) passthrough+=("$arg") ;;
  esac
done

[[ -r /etc/os-release ]] || die "cannot read /etc/os-release; this does not look like a Debian-family box"
# shellcheck source=/dev/null
. /etc/os-release

# Ubuntu, Debian, Raspberry Pi OS (ID=raspbian, ID_LIKE=debian) and Debian-based homelab boxes.
if [[ ${ID:-} != ubuntu && ${ID:-} != debian && ${ID_LIKE:-} != *debian* ]]; then
  die "this script targets Debian-family systems, but ID=${ID:-unknown}"
fi

# The 26.04 check is for the Ubuntu desktop play only.
if [[ ${ID:-} == ubuntu && ${limit} == ubuntu_desktop && ${VERSION_ID:-} != "$TARGET_VERSION" ]]; then
  printf 'bootstrap-ubuntu: warning: written for Ubuntu %s, found %s; continuing\n' \
    "$TARGET_VERSION" "${VERSION_ID:-unknown}" >&2
fi

sudo apt-get update
sudo apt-get install -y git ansible python3-apt

if [[ ! -d $DOTFILES_DIR ]]; then
  git clone "$REPO_URL" "$DOTFILES_DIR"
fi

# The repo's ansible.cfg sets roles_path, inventory and ssh_args; run from here.
cd "$DOTFILES_DIR"

ansible-playbook \
  -i "$inventory" \
  ansible/site.yml \
  --limit "$limit" \
  --ask-become-pass \
  -e dotfiles_git_transport=https \
  "${extra_vars[@]}" \
  "${passthrough[@]}"
