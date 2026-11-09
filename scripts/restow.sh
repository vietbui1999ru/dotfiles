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
# in ~/.config/herdr-app (keys.error, layouts, mods), so only keys.json, the
# layouts/ and mods/ folder links here. layouts/ is created first so stow links
# only the layout files this repo ships (Herdr replaces its shipped layouts). mods/ is created first so stow links only the mod
# folders this repo ships, not the whole directory with Herdr's own mods.
mkdir -p "$HOME/.config/herdr" "$HOME/.config/herdr-app" "$HOME/.config/herdr-app/mods" "$HOME/.config/herdr-app/layouts"

stow -R "${PACKAGES[@]}"
