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
PACKAGES=(zsh starship mise nvim tmux tmuxinator kitty git jj claude opencode pi codex herdr herdr-app)

# herdr writes sockets, logs and session*.json into ~/.config/herdr. If the
# folder is missing, stow links the whole ~/.config/herdr directory into the
# repo and herdr writes that state into ~/dotfiles/herdr/. Creating the real
# folder first makes stow link only config.toml. The Herdr app does the same
# in ~/.config/herdr-app (keys.error, layouts, mods), so only keys.json links.
mkdir -p "$HOME/.config/herdr" "$HOME/.config/herdr-app"

stow -R "${PACKAGES[@]}"
