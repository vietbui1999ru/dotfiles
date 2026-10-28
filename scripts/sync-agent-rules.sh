#!/bin/zsh
# sync-agent-rules.sh
# Generates tool-specific config from dotfiles source of truth.
# Run after updating rules/*.md or shared/AGENTS.md.
#
# Usage: ./scripts/sync-agent-rules.sh
#
# The dotfiles root is this script's own checkout, not $HOME/dotfiles, so a run
# from a worktree syncs that branch's catalogue instead of main's.

DOTFILES=${0:A:h:h}
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

# Codex lists a symlinked agent TOML but cannot spawn it, so copy the stowed definitions
# as regular files. Edit codex/.codex/agents/*.toml in dotfiles; this overwrites the copy.
mkdir -p "$CODEX_DIR/agents"
for _agent in "$HOME"/dotfiles/codex/.codex/agents/*.toml; do
	[ -f "$_agent" ] || continue
	rm -f "$CODEX_DIR/agents/$(basename "$_agent")"
	cp "$_agent" "$CODEX_DIR/agents/"
	echo "✓ Codex: agents/$(basename "$_agent")"
done

# ── MCP Servers ───────────────────────────────────────────────────────────────
# Inject portable URL-based MCP servers into each tool's config. A server dropped
# from the shared catalogue is not re-added; the live entry is removed once, by
# hand, so this script never has to name a retired server.

DOTFILES="$DOTFILES" python3 <<'PYEOF'
import json, os, re

_home = os.path.expanduser("~")
shared_path = os.path.join(os.environ["DOTFILES"], "shared", "mcp-servers.json")
with open(shared_path) as f:
    shared = json.load(f)
servers = shared["servers"]

# Pi is a lean coding harness: context7 for docs and qmd for the local knowledge
# base, nothing general-purpose. Everything else in Pi's list is dropped.
PI_SERVERS = ("context7",)

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

# ── Pi ──
# Pi's built-in MCP client accepts the standard `mcpServers` shape. The list is
# rebuilt on every run: PI_SERVERS plus qmd, with OpenCode's {env:NAME}
# placeholders translated to Pi's ${NAME}. Other keys in the file are kept.
pi_path = f"{_home}/.pi/agent/mcp.json"
try:
    with open(pi_path) as f:
        pi_config = json.load(f)
except FileNotFoundError:
    pi_config = {}

def pi_value(value):
    if isinstance(value, str):
        return re.sub(r"\{env:([^}]+)\}", r"${\1}", value)
    if isinstance(value, dict):
        return {key: pi_value(item) for key, item in value.items()}
    if isinstance(value, list):
        return [pi_value(item) for item in value]
    return value

pi_servers = {}
for name in PI_SERVERS:
    cfg = servers[name]
    pi_servers[name] = {
        key: pi_value(value)
        for key, value in cfg.items()
        if not key.startswith("_")
    }
pi_servers["qmd"] = {
    "command": "qmd",
    "args": ["mcp"],
    "description": "Search the local knowledge base.",
}
pi_config["mcpServers"] = pi_servers

os.makedirs(os.path.dirname(pi_path), exist_ok=True)
with open(pi_path, "w") as f:
    json.dump(pi_config, f, indent=2)
    f.write("\n")
print("✓ Pi: mcp servers set to context7 and qmd only")

PYEOF

# ── Codex MCP ─────────────────────────────────────────────────────────────────
# Codex stores MCP config via `codex mcp add`.

if command -v codex >/dev/null 2>&1; then
	_codex_cfg="$HOME/.codex/config.toml"

	if grep -q '^\[mcp_servers\.qmd\]' "$_codex_cfg" 2>/dev/null; then
		echo "✓ Codex: qmd already configured"
	else
		codex mcp add qmd "$(command -v qmd 2>/dev/null || echo qmd)" mcp 2>/dev/null &&
			echo "✓ Codex: qmd stdio added" ||
			echo "✗ Codex: qmd add failed"
	fi

	echo "  (context7 skipped — Codex MCP client lacks header auth support)"
else
	echo "  (codex CLI not in PATH — skipping MCP registration)"
fi

# ── Claude Code MCP ───────────────────────────────────────────────────────────
# Claude Code ignores `mcpServers` in settings.json; user-scope servers live in
# ~/.claude.json and are managed through `claude mcp`. Re-add on each run so a
# changed entry in claude/.claude/mcp-servers.json takes effect.
_claude_mcp="$DOTFILES/claude/.claude/mcp-servers.json"
if command -v claude >/dev/null 2>&1 && [ -f "$_claude_mcp" ]; then
	for _name in $(jq -r '.servers | keys[]' "$_claude_mcp"); do
		claude mcp remove -s user "$_name" >/dev/null 2>&1
		claude mcp add-json -s user "$_name" "$(jq -c --arg n "$_name" '.servers[$n]' "$_claude_mcp")" >/dev/null 2>&1 &&
			echo "✓ Claude Code: $_name registered (user scope)" ||
			echo "✗ Claude Code: $_name add failed"
	done
else
	echo "  (claude CLI or mcp-servers.json missing — skipping Claude MCP registration)"
fi

# ── Sync OpenCode agents from llm-wiki canonical source ──────────────────────
# Generates .opencode/agents/*.md from claude-setup/agents/*.md with OpenCode
# frontmatter, ending the drift between the two directories.
if [ -f "$HOME/repos/llm-wiki/scripts/sync-agents.py" ]; then
	PYTHONDONTWRITEBYTECODE=1 python3 "$HOME/repos/llm-wiki/scripts/sync-agents.py" --check 2>/dev/null &&
		echo "✓ OpenCode agents in sync with llm-wiki canonical" ||
		echo "⚠ OpenCode agents drifted — run: python3 ~/repos/llm-wiki/scripts/sync-agents.py --force"
fi

echo ""
echo "Done. Files updated:"
echo "  ~/.config/opencode/AGENTS.md"
echo "  ~/.codex/AGENTS.md"
