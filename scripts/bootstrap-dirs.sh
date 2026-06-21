#!/usr/bin/env bash
# bootstrap-dirs.sh
# Creates directories expected by dotfiles (symlinks, tools, etc).
# Safe to re-run — all operations are idempotent.
#
# Usage: ./scripts/bootstrap-dirs.sh

set -euo pipefail

mkdir -p "$HOME/repos"
echo "✓ ~/repos"

# Symlinks in opencode/plugins point into these repos — clone them if absent:
#   ~/repos/Commandr   → commandr-checkpoint.js plugin
#   ~/repos/DiffViewer → diffviewer.js plugin

echo ""
echo "Done."
echo "If opencode plugin symlinks are broken, clone the missing repos into ~/repos:"
echo "  ~/repos/Commandr"
echo "  ~/repos/DiffViewer"
