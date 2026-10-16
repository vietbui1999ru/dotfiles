#!/usr/bin/env bash
# Cloud environment setup script for Claude Code on the web: installs send-it into the VM.
# Paste into the environment's "Setup script" field as:
#   curl -fsSL https://raw.githubusercontent.com/vietbui1999ru/dotfiles/main/scripts/cloud/send-it-setup.sh | bash
# The local /send-it mod (session-band-plugin) cannot load in the cloud, so this writes the same
# settings block as sendItBlock() in session-band-plugin/hooks/send-it.ts, minus the sandbox:
# the VM is the sandbox. API keys come from environment network secrets, never from here:
#   FIRECRAWL_API_KEY -> api.firecrawl.dev, header "Authorization: Bearer <key>"
#   CONTEXT7_API_KEY  -> mcp.context7.com,  header "Authorization: Bearer <key>"
# The firecrawl CLI prompts for login when no key is set, so a placeholder goes in env below;
# the proxy replaces the Authorization header with the real secret.
set -euo pipefail

[ "${CLAUDE_CODE_REMOTE:-}" = "true" ] || { echo "send-it-setup: not a cloud VM, skipping"; exit 0; }

clone() { [ -d "$2/.git" ] || git clone -q --depth 1 "https://github.com/vietbui1999ru/$1.git" "$2"; }
clone dotfiles /opt/dotfiles
clone llm-wiki /opt/llm-wiki

mkdir -p "$HOME/.claude/rules" "$HOME/.claude/agents"
cp /opt/llm-wiki/claude-setup/rules/send-it.md "$HOME/.claude/rules/send-it.md"
cp /opt/dotfiles/claude/.claude/agents/worker.md "$HOME/.claude/agents/worker.md"
ln -sf /opt/dotfiles/scripts/floor-guard /usr/local/bin/floor-guard
ln -sf /opt/dotfiles/scripts/ac-run /usr/local/bin/ac-run

command -v firecrawl >/dev/null || npm install -g --silent firecrawl-cli@1.26.5
command -v gh >/dev/null || { apt-get update -qq && apt-get install -y -qq gh; } || echo "send-it-setup: gh install failed; PRs fall back to the built-in flow"

cat > "$HOME/.claude/settings.json" <<'JSON'
{
  "model": "opus",
  "env": { "SEND_IT": "1", "FIRECRAWL_API_KEY": "fc-placeholder-network-secret" },
  "permissions": {
    "defaultMode": "dontAsk",
    "allow": ["Bash", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Agent", "Skill", "mcp__context7", "mcp__firecrawl"],
    "deny": [
      "AskUserQuestion",
      "Edit(./.claude/settings*.json)",
      "Edit(./.claude/{hooks,agents,rules,commands,skills}/**)",
      "Edit(./.mcp.json)",
      "Edit(./.git/hooks/**)"
    ]
  }
}
JSON
echo "send-it-setup: installed send-it rule, worker agent, floor-guard, ac-run"
