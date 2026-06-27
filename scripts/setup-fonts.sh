#!/usr/bin/env bash
# setup-fonts.sh
# Installs Hack Nerd Font Mono — required by kitty, starship, and tmux configs.
# Safe to re-run — skips if already installed.
#
# macOS: installs via Homebrew cask (preferred) or direct zip download
# Linux: installs to ~/.local/share/fonts/ and refreshes fc-cache
#
# Usage: ./scripts/setup-fonts.sh

set -euo pipefail

FONT_RELEASE_URL="https://github.com/ryanoasis/nerd-fonts/releases/latest/download/Hack.zip"

# ── OS detection ──────────────────────────────────────────────
OS="$(uname)"

# ── Already installed? ────────────────────────────────────────
_installed() {
  case "$OS" in
    Darwin)
      # brew cask installs to /Library/Fonts; direct download goes to ~/Library/Fonts
      test -f "/Library/Fonts/HackNerdFontMono-Regular.ttf" || \
        test -f "$HOME/Library/Fonts/HackNerdFontMono-Regular.ttf"
      ;;
    Linux)
      test -f "$HOME/.local/share/fonts/HackNerdFont/HackNerdFontMono-Regular.ttf"
      ;;
    *)
      return 1
      ;;
  esac
}

if _installed; then
  echo "✓ Hack Nerd Font Mono already installed — skipping"
  exit 0
fi

# ── Install ───────────────────────────────────────────────────
case "$OS" in
  Darwin)
    if command -v brew &>/dev/null; then
      echo "→ Installing via Homebrew cask..."
      brew install --cask font-hack-nerd-font
    else
      echo "→ brew not found — downloading directly to ~/Library/Fonts/..."
      TMP="$(mktemp -d)"
      trap 'rm -rf "$TMP"' EXIT
      curl -fLo "$TMP/Hack.zip" "$FONT_RELEASE_URL"
      mkdir -p "$HOME/Library/Fonts"
      unzip -o "$TMP/Hack.zip" "*.ttf" -d "$HOME/Library/Fonts/"
    fi
    ;;

  Linux)
    FONT_DIR="$HOME/.local/share/fonts/HackNerdFont"
    mkdir -p "$FONT_DIR"
    TMP="$(mktemp -d)"
    trap 'rm -rf "$TMP"' EXIT
    echo "→ Downloading Hack Nerd Font..."
    curl -fLo "$TMP/Hack.zip" "$FONT_RELEASE_URL"
    echo "→ Installing to $FONT_DIR..."
    unzip -o "$TMP/Hack.zip" "*.ttf" -d "$FONT_DIR"
    echo "→ Refreshing font cache..."
    fc-cache -f "$FONT_DIR"
    ;;

  *)
    echo "⚠ Unsupported OS: $OS" >&2
    echo "  Install Hack Nerd Font Mono manually: https://www.nerdfonts.com/font-downloads" >&2
    exit 1
    ;;
esac

echo "✓ Hack Nerd Font Mono installed — restart kitty to apply"
