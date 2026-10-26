#!/usr/bin/env bash
# Bootstrap an Ubuntu 26.04 desktop from the box itself: one script, no GitHub
# SSH key, no second machine. Clones the dotfiles repo over HTTPS and runs the
# ubuntu_desktop play locally. Safe to rerun: an existing ~/dotfiles is left
# alone and the play is idempotent.
#
# Usage: scripts/bootstrap-ubuntu.sh [extra ansible-playbook args]
#   scripts/bootstrap-ubuntu.sh --check
#   scripts/bootstrap-ubuntu.sh --tags dotfiles
set -euo pipefail

readonly REPO_URL=https://github.com/vietbui1999ru/dotfiles.git
readonly TARGET_VERSION=26.04
readonly DOTFILES_DIR="$HOME/dotfiles"

die() {
  printf 'bootstrap-ubuntu: %s\n' "$*" >&2
  exit 1
}

[[ -r /etc/os-release ]] || die "cannot read /etc/os-release; this does not look like Ubuntu"
# shellcheck source=/dev/null
. /etc/os-release

[[ ${ID:-} == ubuntu ]] || die "this script targets Ubuntu, but ID=${ID:-unknown}"

if [[ ${VERSION_ID:-} != "$TARGET_VERSION" ]]; then
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
  -i ansible/inventory/local-ubuntu.yml \
  ansible/site.yml \
  --limit ubuntu_desktop \
  --ask-become-pass \
  -e dotfiles_git_transport=https \
  "$@"
