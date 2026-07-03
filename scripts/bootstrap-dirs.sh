#!/usr/bin/env bash
# bootstrap-dirs.sh
# Creates directories expected by dotfiles (symlinks, tools, etc).
# Safe to re-run — all operations are idempotent.
#
# Usage: ./scripts/bootstrap-dirs.sh

set -euo pipefail

mkdir -p "$HOME/repos" "$HOME/.local/bin"
echo "✓ ~/repos"

if [ -x "$HOME/dotfiles/scripts/agent-workflow" ]; then
	ln -sf "$HOME/dotfiles/scripts/agent-workflow" "$HOME/.local/bin/agent-workflow"
	echo "✓ ~/.local/bin/agent-workflow → ~/dotfiles/scripts/agent-workflow"
fi

if [ -x "$HOME/dotfiles/scripts/agent-session" ]; then
	ln -sf "$HOME/dotfiles/scripts/agent-session" "$HOME/.local/bin/agent-session"
	echo "✓ ~/.local/bin/agent-session → ~/dotfiles/scripts/agent-session"
fi

# llm-wiki is a git submodule at ~/dotfiles/repos/llm-wiki.
# Symlinks inside ~/.claude/ point to ~/repos/llm-wiki, so we create that as a
# redirect on machines where the standalone clone doesn't exist.
DOTFILES_WIKI="$HOME/dotfiles/repos/llm-wiki"
REPOS_WIKI="$HOME/repos/llm-wiki"
if [ -e "$DOTFILES_WIKI/.git" ] && [ ! -e "$REPOS_WIKI" ]; then
	ln -s "$DOTFILES_WIKI" "$REPOS_WIKI"
	echo "✓ ~/repos/llm-wiki → ~/dotfiles/repos/llm-wiki"
elif [ -e "$REPOS_WIKI" ]; then
	echo "✓ ~/repos/llm-wiki (exists — standalone clone or symlink already present)"
else
	echo "⚠ ~/dotfiles/repos/llm-wiki not populated — run: git submodule update --init"
fi

# Materialize known_marketplaces.json from llm-wiki template.
# Template uses ${HOME} placeholder; envsubst expands only that variable so
# that Claude Code's own ${env:VAR} opencode syntax is left untouched.
WIKI_KM_TEMPLATE="$HOME/repos/llm-wiki/claude-setup/plugins/known_marketplaces.json"
CLAUDE_KM_FILE="$HOME/.claude/plugins/known_marketplaces.json"
if [ ! -f "$CLAUDE_KM_FILE" ] && [ -f "$WIKI_KM_TEMPLATE" ]; then
	mkdir -p "$(dirname "$CLAUDE_KM_FILE")"
	HOME="$HOME" envsubst '${HOME}' <"$WIKI_KM_TEMPLATE" >"$CLAUDE_KM_FILE"
	echo "✓ ~/.claude/plugins/known_marketplaces.json (materialized from llm-wiki template)"
elif [ -f "$CLAUDE_KM_FILE" ]; then
	echo "✓ ~/.claude/plugins/known_marketplaces.json (exists — Claude Code manages updates)"
else
	echo "⚠ llm-wiki template missing — skipping known_marketplaces.json (run after submodule init)"
fi

# Materialize opencode.json from dotfiles template.
# Template uses ${HOME} placeholder; only that variable is expanded.
OPENCODE_TEMPLATE="$HOME/dotfiles/opencode/.config/opencode/opencode.json"
OPENCODE_CONFIG="$HOME/.config/opencode/opencode.json"
if [ ! -f "$OPENCODE_CONFIG" ] && [ -f "$OPENCODE_TEMPLATE" ]; then
	mkdir -p "$(dirname "$OPENCODE_CONFIG")"
	HOME="$HOME" envsubst '${HOME}' <"$OPENCODE_TEMPLATE" >"$OPENCODE_CONFIG"
	echo "✓ ~/.config/opencode/opencode.json (materialized from dotfiles template)"
elif [ -f "$OPENCODE_CONFIG" ]; then
	echo "✓ ~/.config/opencode/opencode.json (exists — run sync-agent-rules.sh to update MCP)"
else
	echo "⚠ opencode template missing — skipping opencode.json"
fi

# Materialize agent-workflow config from dotfiles default.
AGENT_WORKFLOW_TEMPLATE="$HOME/dotfiles/shared/agent-workflow.default.json"
AGENT_WORKFLOW_CONFIG="$HOME/.config/agent-workflow/config.json"
if [ ! -f "$AGENT_WORKFLOW_CONFIG" ] && [ -f "$AGENT_WORKFLOW_TEMPLATE" ]; then
	mkdir -p "$(dirname "$AGENT_WORKFLOW_CONFIG")"
	cp "$AGENT_WORKFLOW_TEMPLATE" "$AGENT_WORKFLOW_CONFIG"
	echo "✓ ~/.config/agent-workflow/config.json (materialized from dotfiles default)"
elif [ -f "$AGENT_WORKFLOW_CONFIG" ]; then
	echo "✓ ~/.config/agent-workflow/config.json (exists)"
else
	echo "⚠ agent-workflow default missing — skipping config"
fi

# Symlinks in opencode/plugins point into these repos — clone them if absent:
#   ~/repos/Commandr   → commandr-checkpoint.js plugin
#   ~/repos/DiffViewer → diffviewer.js plugin

echo ""
echo "Done."
echo "If opencode plugin symlinks are broken, clone the missing repos into ~/repos:"
echo "  ~/repos/Commandr"
echo "  ~/repos/DiffViewer"
