#!/usr/bin/env bash
# bootstrap-dirs.sh
# Creates directories expected by dotfiles (symlinks, tools, etc).
# Safe to re-run — all operations are idempotent.
#
# Usage: ./scripts/bootstrap-dirs.sh

set -euo pipefail

mkdir -p "$HOME/repos"
echo "✓ ~/repos"

# llm-wiki is a git submodule at ~/dotfiles/repos/llm-wiki.
# Symlinks inside ~/.claude/ point to ~/repos/llm-wiki, so we create that as a
# redirect on machines where the standalone clone doesn't exist.
DOTFILES_WIKI="$HOME/dotfiles/repos/llm-wiki"
REPOS_WIKI="$HOME/repos/llm-wiki"
if [ -d "$DOTFILES_WIKI/.git" ] && [ ! -e "$REPOS_WIKI" ]; then
  ln -s "$DOTFILES_WIKI" "$REPOS_WIKI"
  echo "✓ ~/repos/llm-wiki → ~/dotfiles/repos/llm-wiki"
elif [ -e "$REPOS_WIKI" ]; then
  echo "✓ ~/repos/llm-wiki (exists — standalone clone or symlink already present)"
else
  echo "⚠ ~/dotfiles/repos/llm-wiki not populated — run: git submodule update --init"
fi

# Symlinks in opencode/plugins point into these repos — clone them if absent:
#   ~/repos/Commandr   → commandr-checkpoint.js plugin
#   ~/repos/DiffViewer → diffviewer.js plugin

echo ""
echo "Done."
echo "If opencode plugin symlinks are broken, clone the missing repos into ~/repos:"
echo "  ~/repos/Commandr"
echo "  ~/repos/DiffViewer"
