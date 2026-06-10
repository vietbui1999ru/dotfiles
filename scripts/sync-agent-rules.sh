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

# ── Gemini CLI ────────────────────────────────────────────────────────────────
# Gemini reads ~/.gemini/GEMINI.md. The dotfiles version lives at
# ~/dotfiles/gemini/.gemini/GEMINI.md and is normally stow-managed.
# If stow hasn't run, copy it into place as a fallback.

GEMINI_DIR="$HOME/.gemini"
GEMINI_SRC="$DOTFILES/gemini/.gemini/GEMINI.md"
mkdir -p "$GEMINI_DIR"
if [ ! -L "$GEMINI_DIR/GEMINI.md" ] && [ -f "$GEMINI_SRC" ]; then
  cp "$GEMINI_SRC" "$GEMINI_DIR/GEMINI.md"
  echo "✓ Gemini: $GEMINI_DIR/GEMINI.md (copied — consider \`stow gemini\`)"
else
  echo "✓ Gemini: GEMINI.md already in place (stow-linked or copied)"
fi

# Link Gemini-native skills from the llm-wiki-plugin (idempotent).
if command -v gemini >/dev/null 2>&1; then
  for skill in wiki agent-patterns security; do
    gemini skills link "$DOTFILES/llm-wiki-plugin/skills/$skill/" --consent 2>/dev/null \
      && echo "  ↳ linked skill: $skill" \
      || echo "  ↳ skill $skill already linked or unavailable"
  done

  # Best-effort migration of Claude hooks.
  # Must run from $HOME so gemini finds ~/.claude/settings.json, not the dotfiles-local .claude/.
  (cd "$HOME" && gemini hooks migrate --from-claude 2>/dev/null) \
    && echo "  ↳ Claude hooks migrated" \
    || echo "  ↳ hooks migration skipped — run manually: cd ~ && gemini hooks migrate --from-claude"
else
  echo "  (gemini CLI not in PATH — skipping skills link + hooks migrate)"
fi

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
echo "  (domain .mdc files are stow-managed from dotfiles/cursor/.cursor/rules/ — not regenerated)"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Done. Files updated:"
echo "  ~/.config/opencode/AGENTS.md"
echo "  ~/.codex/AGENTS.md"
echo "  ~/.cursor/rules/core.mdc"
echo ""
echo "Cursor domain rules (learning, intermediate, research, applied-ai) are"
echo "stow-managed from dotfiles/cursor/.cursor/rules/ — run 'stow cursor' to deploy."

# ── MCP Servers ───────────────────────────────────────────────────────────────
# Inject portable URL-based MCP servers into each tool's config.
# Stdio servers (qmd, cgc) are not touched — they're tool-specific.

MCP_SHARED="$DOTFILES/shared/mcp-servers.json"

python3 << 'PYEOF'
import json, sys

import os as _os
_home = _os.path.expanduser("~")
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
        # Update URL and headers but preserve other fields
        config["mcp"][name].update({"url": cfg["url"]})
        if "headers" in cfg:
            config["mcp"][name]["headers"] = cfg["headers"]

# Add qmd as a local stdio MCP for OpenCode.
# OpenCode requires `command` as an array; no separate `args` field.
# Use bare "qmd" — PATH-resolved so it works on any machine regardless of nvm version.
config["mcp"]["qmd"] = {
    "type": "local",
    "command": ["qmd", "mcp"],
    "enabled": True,
}

with open(opencode_path, "w") as f:
    json.dump(config, f, indent=2)
print("✓ OpenCode: mcp servers synced (incl. qmd stdio)")

# ── Cursor ──
cursor_path = f"{_home}/.cursor/mcp.json"
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

# ── Gemini ──
# Merge shared remote MCPs + qmd stdio into ~/.gemini/settings.json,
# preserving the security.auth section and other top-level keys.
import os
gemini_path = os.path.expanduser("~/.gemini/settings.json")
try:
    with open(gemini_path) as f:
        gemini_cfg = json.load(f)
except (FileNotFoundError, json.JSONDecodeError):
    gemini_cfg = {}

gemini_cfg.setdefault("security", {}).setdefault("auth", {}).setdefault(
    "selectedType", "oauth-personal"
)
gemini_cfg.setdefault("mcpServers", {})

# qmd stdio — bare binary, PATH-resolved
gemini_cfg["mcpServers"]["qmd"] = {"command": "qmd", "args": ["mcp"]}

# Remote servers from shared/mcp-servers.json
for name, cfg in servers.items():
    entry = {"url": cfg["url"]}
    if "headers" in cfg:
        entry["headers"] = cfg["headers"]
    gemini_cfg["mcpServers"][name] = entry

# Drop legacy Claude-specific fields Gemini rejects.
for srv_name, srv in list(gemini_cfg["mcpServers"].items()):
    for bad_field in ("tools", "disabled", "alwaysAllow"):
        srv.pop(bad_field, None)

# Inject context.fileName so Gemini natively reads shared AGENTS.md.
gemini_cfg.setdefault("context", {})
gemini_cfg["context"]["fileName"] = ["AGENTS.md", "GEMINI.md"]

with open(gemini_path, "w") as f:
    json.dump(gemini_cfg, f, indent=2)
print("✓ Gemini: mcp servers synced + context.fileName injected")

PYEOF

# ── Codex MCP ─────────────────────────────────────────────────────────────────
# Codex stores MCP config via `codex mcp add`. Stdio + URL-based remotes only;
# arbitrary header auth is unsupported, so context7 (which needs an API key
# header) is intentionally skipped — see weaknesses/codex-limitations.md.

if command -v codex >/dev/null 2>&1; then
  codex mcp add qmd "$(command -v qmd 2>/dev/null || echo qmd)" mcp 2>/dev/null \
    && echo "✓ Codex: qmd stdio added" \
    || echo "✓ Codex: qmd already configured"

  codex mcp add --url https://www.shadcn.io/api/mcp shadcn 2>/dev/null \
    && echo "✓ Codex: shadcn remote added" \
    || echo "✓ Codex: shadcn already configured"

  codex mcp add --url https://mcp.sentry.dev/mcp sentry 2>/dev/null \
    && echo "✓ Codex: sentry remote added" \
    || echo "✓ Codex: sentry already configured"

  echo "  (context7 skipped — Codex MCP client lacks header auth support)"
else
  echo "  (codex CLI not in PATH — skipping MCP registration)"
fi
