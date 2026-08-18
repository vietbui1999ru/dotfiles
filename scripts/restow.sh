#!/usr/bin/env bash
# restow.sh
# Restow all managed stow packages. Safe to re-run — stow -R is idempotent
# and works whether or not a package was previously stowed.
#
# Usage: ./scripts/restow.sh

set -euo pipefail
cd "$(dirname "$0")/.."

# codex omitted: it's an empty dir today (README calls it a no-op stub),
# and git doesn't track empty dirs, so `stow codex` fails on a fresh clone.
PACKAGES=(zsh starship nvim tmux tmuxinator kitty git jj claude opencode pi)

stow -R "${PACKAGES[@]}"
