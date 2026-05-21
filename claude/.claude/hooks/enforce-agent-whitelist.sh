#!/usr/bin/env bash
# PreToolUse hook — blocks Agent tool calls that use non-configured agent types.
# Only agents in ~/.claude/agents/*.md or the PLUGIN_AGENTS list are allowed.
# Exit 0 = allow. Exit 2 = block (stdout is shown as the block reason).

INPUT=$(cat)

# Extract subagent_type and model from tool input JSON
SUBAGENT_TYPE=$(echo "$INPUT" | jq -r '.tool_input.subagent_type // ""' 2>/dev/null)
MODEL=$(echo "$INPUT" | jq -r '.tool_input.model // ""' 2>/dev/null)

# If no subagent_type specified, that means general-purpose (the default) — block it
if [ -z "$SUBAGENT_TYPE" ]; then
  echo "BLOCKED: Agent called without subagent_type — would default to 'general-purpose', which is banned."
  echo "Specify a configured agent from ~/.claude/agents/ or an approved plugin agent."
  exit 2
fi

# Require explicit model param — forces conscious routing decision per model-routing.md
if [ -z "$MODEL" ]; then
  echo "BLOCKED: Agent spawn for '$SUBAGENT_TYPE' missing explicit model param."
  echo "Set model: haiku | sonnet | opus based on task complexity:"
  echo "  haiku  — single-step mechanical work, lookups, boilerplate"
  echo "  sonnet — multi-file impl, review, debugging, standard orchestration"
  echo "  opus   — architecture, security audits, irreversible ops, hard bugs"
  exit 2
fi

VALID_MODELS=("haiku" "sonnet" "opus")
MODEL_OK=0
for m in "${VALID_MODELS[@]}"; do
  [ "$MODEL" = "$m" ] && MODEL_OK=1 && break
done
if [ "$MODEL_OK" -eq 0 ]; then
  echo "BLOCKED: model '$MODEL' is not a valid tier. Use: haiku | sonnet | opus"
  exit 2
fi

# Build whitelist: all .md files in ~/.claude/agents/ (strip .md suffix)
AGENTS_DIR="$HOME/.claude/agents"
declare -A WHITELIST

if [ -d "$AGENTS_DIR" ]; then
  for file in "$AGENTS_DIR"/*.md; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .md)
    WHITELIST["$name"]=1
  done
fi

# Approved plugin agents (namespaced — not resolvable from file system)
PLUGIN_AGENTS=(
  "feature-dev:code-architect"
  "feature-dev:code-explorer"
  "feature-dev:code-reviewer"
  "code-simplifier:code-simplifier"
  "agent-sdk-dev:agent-sdk-verifier-py"
  "agent-sdk-dev:agent-sdk-verifier-ts"
  "claude-code-guide"
  "Explore"
  "Plan"
  "statusline-setup"
)
for pa in "${PLUGIN_AGENTS[@]}"; do
  WHITELIST["$pa"]=1
done

# Check
if [ "${WHITELIST[$SUBAGENT_TYPE]+_}" ]; then
  exit 0
fi

# Blocked — build allowed list for the error message
ALLOWED=$(printf '%s\n' "${!WHITELIST[@]}" | sort | tr '\n' ', ' | sed 's/,$//')
echo "BLOCKED: Agent type '$SUBAGENT_TYPE' is not a configured agent."
echo "Use only agents from ~/.claude/agents/ or approved plugin agents."
echo "Allowed: $ALLOWED"
exit 2
