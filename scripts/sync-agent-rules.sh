#!/bin/zsh
# sync-agent-rules.sh
# Generates tool-specific config from dotfiles source of truth.
# Run after updating rules/*.md or shared/AGENTS.md.
#
# Usage: ./scripts/sync-agent-rules.sh

DOTFILES="$HOME/dotfiles"
SHARED="$DOTFILES/shared/AGENTS.md"

echo "Syncing agent rules..."

# ── OpenCode ──────────────────────────────────────────────────────────────────
# OpenCode reads ~/.config/opencode/AGENTS.md explicitly.

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

# ── MCP Servers ───────────────────────────────────────────────────────────────
# Inject portable URL-based MCP servers into each tool's config.

python3 << 'PYEOF'
import json, os

_home = os.path.expanduser("~")
shared_path = f"{_home}/dotfiles/shared/mcp-servers.json"
with open(shared_path) as f:
    shared = json.load(f)
servers = shared["servers"]

# ── OpenCode ──
opencode_path = f"{_home}/.config/opencode/opencode.json"
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
        config["mcp"][name].update({"url": cfg["url"]})
        if "headers" in cfg:
            config["mcp"][name]["headers"] = cfg["headers"]

config["mcp"]["qmd"] = {
    "type": "local",
    "command": ["qmd", "mcp"],
    "enabled": True,
}

with open(opencode_path, "w") as f:
    json.dump(config, f, indent=2)
print("✓ OpenCode: mcp servers synced (incl. qmd stdio)")

PYEOF

# ── Codex MCP ─────────────────────────────────────────────────────────────────
# Codex stores MCP config via `codex mcp add`.

if command -v codex >/dev/null 2>&1; then
  _codex_cfg="$HOME/.codex/config.toml"

  if grep -q '^\[mcp_servers\.qmd\]' "$_codex_cfg" 2>/dev/null; then
    echo "✓ Codex: qmd already configured"
  else
    codex mcp add qmd "$(command -v qmd 2>/dev/null || echo qmd)" mcp 2>/dev/null \
      && echo "✓ Codex: qmd stdio added" \
      || echo "✗ Codex: qmd add failed"
  fi

  if grep -q '^\[mcp_servers\.shadcn\]' "$_codex_cfg" 2>/dev/null; then
    echo "✓ Codex: shadcn already configured"
  else
    codex mcp add --url https://www.shadcn.io/api/mcp shadcn 2>/dev/null \
      && echo "✓ Codex: shadcn remote added" \
      || echo "✗ Codex: shadcn add failed"
  fi

  if grep -q '^\[mcp_servers\.sentry\]' "$_codex_cfg" 2>/dev/null; then
    echo "✓ Codex: sentry already configured"
  else
    codex mcp add --url https://mcp.sentry.dev/mcp sentry 2>/dev/null \
      && echo "✓ Codex: sentry remote added" \
      || echo "✗ Codex: sentry add failed"
  fi

  echo "  (context7 skipped — Codex MCP client lacks header auth support)"
else
  echo "  (codex CLI not in PATH — skipping MCP registration)"
fi

echo ""
echo "Done. Files updated:"
echo "  ~/.config/opencode/AGENTS.md"
echo "  ~/.codex/AGENTS.md"
