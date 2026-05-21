#!/usr/bin/env bash
# PreToolUse hook — fire save-session directive when context hits 70%.
# Belt-and-suspenders: tries to read context % from hook stdin.
# If not available in stdin, silently passes (context-lifecycle.md rule is fallback).
#
# !! BROKEN — AUTO-TRIGGER DOES NOT WORK !!
# CC PreToolUse hook stdin only includes: session_id, transcript_path, tool_name, tool_input.
# context_window.used_percentage is NOT present — it only exists in the status line input.
# CTX_PCT is always empty, so this hook ALWAYS exits 0. The 70% threshold never fires.
#
# What actually works:
#   - Main session: model sees ctx:% in the status bar → should invoke /save-session or
#     /clear-context manually when it notices the threshold.
#   - Spawned agents: agent-delegator now injects session-state.md into subagent prompts.
#
# To fix: CC would need to expose context_window data in PreToolUse stdin. Not possible now.
# TODO: repurpose or remove if CC adds ctx% to hook stdin in a future release.

INPUT=$(cat)

# Skip if this tool call is writing to session-state.md (prevents infinite loop)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
[[ "$FILE_PATH" == *"session-state.md"* ]] && exit 0

# Try to extract context window usage from hook stdin
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)

# Not available in stdin — silently pass (instruction-based rule handles threshold)
[[ -z "$CTX_PCT" ]] && exit 0

CTX_INT=$(printf "%.0f" "$CTX_PCT" 2>/dev/null || echo "0")

[[ "$CTX_INT" -lt 70 ]] && exit 0

# Resolve state file — agent context writes to .agents/claimed/, orchestrator to .claude/
# Env vars don't cross hook process boundaries — use .agent-task-id sentinel file instead.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
MAIN_REPO=$(cd "$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)")" && pwd 2>/dev/null)
TASK_ID=$(cat "${REPO_ROOT}/.agent-task-id" 2>/dev/null)
if [[ -n "$TASK_ID" ]]; then
  SESSION_STATE="${MAIN_REPO}/.agents/claimed/${TASK_ID}.state.md"
else
  SESSION_STATE="${MAIN_REPO}/.claude/session-state.md"
fi

# Check if we saved recently (within 30 min) to avoid repeated triggers
if [[ -f "$SESSION_STATE" ]]; then
  LAST_SAVED=$(stat -f "%m" "$SESSION_STATE" 2>/dev/null || stat -c "%Y" "$SESSION_STATE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  AGE=$(( NOW - LAST_SAVED ))
  [[ "$AGE" -lt 1800 ]] && exit 0  # saved within 30 min — skip
fi

# Exit 2 blocks the tool call and shows this message to Claude
cat <<'EOF'
CONTEXT THRESHOLD: Context window is at 70%+ capacity.

Before proceeding with any tool call, invoke the save-session skill:
  /save-session

This saves full narrative state to .claude/session-state.md (status: active).
After saving, you may continue OR guide the user through /clear to start fresh.

The next session will automatically inject the saved state.
EOF
exit 2
