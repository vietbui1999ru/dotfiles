#!/bin/zsh
# sync-agent-rules.sh
# Generates tool-specific config from dotfiles source of truth.
# Run after updating rules/*.md or shared/AGENTS.md.
#
# Usage: ./scripts/sync-agent-rules.sh

DOTFILES="$HOME/dotfiles"
RULES="$DOTFILES/claude/.claude/rules"
SHARED="$DOTFILES/shared/AGENTS.md"

echo "Syncing agent rules..."

# ── OpenCode ──────────────────────────────────────────────────────────────────
# OpenCode reads ~/.config/opencode/AGENTS.md explicitly.
# Falls back to ~/.claude/CLAUDE.md if not present.
# We provide explicit file so OpenCode gets the flat universal format.

OPENCODE_DIR="$HOME/.config/opencode"
mkdir -p "$OPENCODE_DIR"
cp "$SHARED" "$OPENCODE_DIR/AGENTS.md"
echo "✓ OpenCode: $OPENCODE_DIR/AGENTS.md"

# ── Codex ─────────────────────────────────────────────────────────────────────
# Codex reads ~/.codex/AGENTS.md as global instructions.

CODEX_DIR="$HOME/.codex"
mkdir -p "$CODEX_DIR"
cp "$SHARED" "$CODEX_DIR/AGENTS.md"
echo "✓ Codex: $CODEX_DIR/AGENTS.md"

# ── Cursor ────────────────────────────────────────────────────────────────────
# Cursor reads ~/.cursor/rules/*.mdc for global rules.
# We regenerate the core.mdc from rules/core.md and rules/editing.md.
# Domain rules stay hand-authored (they have glob metadata we can't auto-generate).

CURSOR_RULES="$HOME/.cursor/rules"
mkdir -p "$CURSOR_RULES"

# Regenerate core.mdc from core.md + editing.md
cat > "$CURSOR_RULES/core.mdc" << 'CURSOR_EOF'
---
description: Core behavior and editing policy for all sessions
globs: ["**/*"]
alwaysApply: true
---
CURSOR_EOF

# Append core rules content (strip any existing frontmatter)
sed '/^---$/,/^---$/d' "$RULES/core.md" >> "$CURSOR_RULES/core.mdc"
echo "" >> "$CURSOR_RULES/core.mdc"
sed '/^---$/,/^---$/d' "$RULES/editing.md" >> "$CURSOR_RULES/core.mdc"

echo "✓ Cursor: $CURSOR_RULES/core.mdc"
echo "  (domain .mdc files are hand-authored — not regenerated)"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Done. Files updated:"
echo "  ~/.config/opencode/AGENTS.md"
echo "  ~/.codex/AGENTS.md"
echo "  ~/.cursor/rules/core.mdc"
echo ""
echo "Cursor domain rules (learning, intermediate, research, applied-ai) are"
echo "hand-authored in ~/dotfiles/cursor/.cursor/rules/ — update them manually."

# ── MCP Servers ───────────────────────────────────────────────────────────────
# Inject portable URL-based MCP servers into each tool's config.
# Stdio servers (qmd, cgc) are not touched — they're tool-specific.

MCP_SHARED="$DOTFILES/shared/mcp-servers.json"

python3 << 'PYEOF'
import json, sys

shared_path = "/Users/vietquocbui/dotfiles/shared/mcp-servers.json"
with open(shared_path) as f:
    shared = json.load(f)
servers = shared["servers"]

# ── OpenCode ──
opencode_path = "/Users/vietquocbui/.config/opencode/opencode.json"
try:
    with open(opencode_path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {"$schema": "https://opencode.ai/config.json"}

config.setdefault("mcp", {})
for name, cfg in servers.items():
    entry = {"type": "remote", "enabled": True, **cfg}
    if name not in config["mcp"]:
        config["mcp"][name] = entry
    else:
        # Update URL and headers but preserve other fields
        config["mcp"][name].update({"url": cfg["url"]})
        if "headers" in cfg:
            config["mcp"][name]["headers"] = cfg["headers"]

with open(opencode_path, "w") as f:
    json.dump(config, f, indent=2)
print("✓ OpenCode: mcp servers synced")

# ── Cursor ──
cursor_path = "/Users/vietquocbui/.cursor/mcp.json"
try:
    with open(cursor_path) as f:
        config = json.load(f)
except FileNotFoundError:
    config = {}

config.setdefault("mcpServers", {})
for name, cfg in servers.items():
    if name not in config["mcpServers"]:
        config["mcpServers"][name] = cfg
    else:
        config["mcpServers"][name].update({"url": cfg["url"]})
        if "headers" in cfg:
            config["mcpServers"][name]["headers"] = cfg["headers"]

with open(cursor_path, "w") as f:
    json.dump(config, f, indent=2)
print("✓ Cursor: mcp servers synced")

PYEOF
