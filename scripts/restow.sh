#!/usr/bin/env bash
# restow.sh
# Restow all managed stow packages. Safe to re-run — stow -R is idempotent
# and works whether or not a package was previously stowed.
#
# Usage: ./scripts/restow.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# codex carries only hooks.json: the rest of ~/.codex is machine state
# (auth.json, sessions/) or holds credentials (config.toml), so it stays untracked.
PACKAGES=(zsh starship nvim tmux tmuxinator kitty git jj claude opencode pi codex)

stow -R "${PACKAGES[@]}"
