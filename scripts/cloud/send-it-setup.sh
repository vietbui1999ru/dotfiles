#!/usr/bin/env bash
# Cloud environment setup script for Claude Code on the web: installs the send-it rule into the VM.
# Paste into the environment's "Setup script" field as (use the merged commit SHA, not main):
#   curl -fsSL https://raw.githubusercontent.com/vietbui1999ru/dotfiles/<merged-sha>/scripts/cloud/send-it-setup.sh | bash
# API keys come from environment network secrets, never from here.
# Repos are pinned to commits so a later push to main does not change what runs in new VMs.
set -euo pipefail

DOTFILES_SHA=e677f298c2d65695a06bffdbb2ecdc3a647e9195
LLMWIKI_SHA=e376ff3ba3104f5affbb3b88d769c9f9ff4ee2c2

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || { echo "send-it-setup: not a cloud VM, skipping"; exit 0; }

# clone NAME DIR SHA: clone once, then check out the pinned commit.
clone() {
  [ -d "$2/.git" ] || git clone -q "https://github.com/vietbui1999ru/$1.git" "$2"
  git -C "$2" cat-file -e "$3^{commit}" 2>/dev/null || git -C "$2" fetch -q origin
  git -C "$2" checkout -q --detach "$3"
}
clone dotfiles /opt/dotfiles "$DOTFILES_SHA"
clone llm-wiki /opt/llm-wiki "$LLMWIKI_SHA"

mkdir -p "$HOME/.claude/rules"
cp /opt/llm-wiki/claude-setup/rules/send-it.md "$HOME/.claude/rules/send-it.md"
# CLAUDE.md imports the rule; a file in ~/.claude/rules alone is not loaded.
grep -qxF '@~/.claude/rules/send-it.md' "$HOME/.claude/CLAUDE.md" 2>/dev/null \
  || echo '@~/.claude/rules/send-it.md' >> "$HOME/.claude/CLAUDE.md"

echo "send-it-setup: installed send-it rule (imported via CLAUDE.md)"
