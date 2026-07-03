#!/usr/bin/env bash
# PreToolUse hook — soft-stop at 70%+ context.
# Only hard-blocks Agent spawns. All other tools pass through;
# context-threshold-notify.sh (PostToolUse) handles the directive after each tool completes.

INPUT=$(cat)

# Hard-block Agent spawns at threshold — save workflow never spawns agents,
# and an agent at 70%+ would deepen the hole.
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)

# Try to extract context window usage from hook stdin.
CACHE_FILE="$HOME/.claude/state/statusline-context.json"
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)

# Statusline fallback — hook stdin does not expose ctx%, so read the cached value.
if [[ -z "$CTX_PCT" && -f "$CACHE_FILE" ]]; then
  UPDATED_AT=$(jq -r '.updated_at // 0' "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [[ "$UPDATED_AT" =~ ^[0-9]+$ ]] && (( NOW - UPDATED_AT <= 300 )); then
    CTX_PCT=$(jq -r '.used_percentage // empty' "$CACHE_FILE" 2>/dev/null)
  fi
fi

# Not available — silently pass
[[ -z "$CTX_PCT" ]] && exit 0

CTX_INT=$(printf "%.0f" "$CTX_PCT" 2>/dev/null || echo "0")

[[ "$CTX_INT" -lt 70 ]] && exit 0

# At threshold: only block Agent spawns.
if [[ "$TOOL_NAME" == "Agent" ]]; then
  cat <<'EOF'
CONTEXT THRESHOLD (70%+): Agent spawns are blocked at this context level.
Invoke /clear-context first to save state and clear context, then retry.
EOF
  exit 2
fi

# All other tools pass through — PostToolUse hook delivers the directive after completion.
exit 0
