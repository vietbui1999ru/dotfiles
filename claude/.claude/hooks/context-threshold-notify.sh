#!/usr/bin/env bash
# PostToolUse hook — emit SOFT STOP directive when context hits 70%+.
# Works in both orchestrator (main session) and agent (worktree) contexts.
# Per-agent flag namespacing prevents parallel agents from interfering.

INPUT=$(cat)

# Read context percentage (stdin first, statusline cache fallback).
CACHE_FILE="$HOME/.claude/state/statusline-context.json"
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)
if [[ -z "$CTX_PCT" && -f "$CACHE_FILE" ]]; then
  UPDATED_AT=$(jq -r '.updated_at // 0' "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [[ "$UPDATED_AT" =~ ^[0-9]+$ ]] && (( NOW - UPDATED_AT <= 300 )); then
    CTX_PCT=$(jq -r '.used_percentage // empty' "$CACHE_FILE" 2>/dev/null)
  fi
fi
[[ -z "$CTX_PCT" ]] && exit 0

CTX_INT=$(printf "%.0f" "$CTX_PCT" 2>/dev/null || echo "0")

# Resolve agent context — must happen before flag naming and message routing.
REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)
MAIN_REPO=$(cd "$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)")" && pwd 2>/dev/null)
TASK_ID=$(cat "${REPO_ROOT}/.agent-task-id" 2>/dev/null)
if [[ -n "$TASK_ID" ]]; then
  SESSION_STATE="${MAIN_REPO}/.agents/claimed/${TASK_ID}.state.md"
  IS_AGENT=true
  # Per-agent flag — parallel agents don't share flag state.
  NOTIFY_FLAG="$HOME/.claude/state/ctx-notified-${TASK_ID}"
else
  SESSION_STATE="${MAIN_REPO}/.claude/session-state.md"
  IS_AGENT=false
  NOTIFY_FLAG="$HOME/.claude/state/ctx-notified"
fi

# Below threshold: clear this context's flag and pass.
if [[ "$CTX_INT" -lt 70 ]]; then
  rm -f "$NOTIFY_FLAG"
  exit 0
fi

# --- At 70%+ threshold ---

# Step 1: Save-critical check — pass silently, do not interrupt save workflow.
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty' 2>/dev/null)

is_save_critical=false
# file_path-based saves
if [[ "$FILE_PATH" == *"session-state.md"* || "$FILE_PATH" == *".state.md"* \
   || "$FILE_PATH" == *"agents/claimed/"* || "$FILE_PATH" == *"memory/"* \
   || "$FILE_PATH" == *"MEMORY.md"* || "$FILE_PATH" == *"log.md"* ]]; then
  is_save_critical=true
fi
# Bash commands writing to save paths (sed on state files, etc.)
if [[ "$TOOL_NAME" == "Bash" ]]; then
  if [[ "$COMMAND" == *"session-state.md"* || "$COMMAND" == *"agents/claimed/"* \
     || "$COMMAND" == *".state.md"* ]]; then
    is_save_critical=true
  fi
fi
[[ "$is_save_critical" == "true" ]] && exit 0

# Step 2: Recent-save debounce — prevent false re-fire after /clear when cache is stale.
# Matches the 5-min statusline cache window.
if [[ -f "$SESSION_STATE" ]]; then
  LAST_SAVED=$(stat -f "%m" "$SESSION_STATE" 2>/dev/null || stat -c "%Y" "$SESSION_STATE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if (( NOW - LAST_SAVED <= 300 )); then
    exit 0  # save ran within last 5 min — likely a post-/clear false positive
  fi
fi

# Step 3: Emit context-aware directive.
if [[ -f "$NOTIFY_FLAG" ]]; then
  # Re-fire: Claude saw the directive but kept running non-save tools.
  if [[ "$IS_AGENT" == "true" ]]; then
    cat <<EOF
CONTEXT SOFT STOP (still 70%+, agent task: ${TASK_ID}): Save your current state and return early.
Invoke the save-session skill to write progress to .agents/claimed/${TASK_ID}.state.md,
then stop and return a status summary to the orchestrator.
EOF
  else
    cat <<'EOF'
CONTEXT SOFT STOP (still 70%+): Please invoke /clear-context before continuing.
EOF
  fi
else
  touch "$NOTIFY_FLAG"
  if [[ "$IS_AGENT" == "true" ]]; then
    cat <<EOF
CONTEXT SOFT STOP (70%+, agent task: ${TASK_ID}): Last tool completed. Context at threshold.

This is an autonomous agent context — do not wait for user input. Instead:
1. Invoke the save-session skill to write current progress to:
     .agents/claimed/${TASK_ID}.state.md
2. Return early to the orchestrator with a status summary:
     "Context threshold reached at 70%+. State saved. Completed: [X]. Remaining: [Y]."
3. Do not start new tool calls other than save-session writes and git reads.
EOF
  else
    cat <<'EOF'
CONTEXT SOFT STOP (70%+): Last tool completed. Context is at threshold.

Invoke the clear-context skill now:
  /clear-context

Do not execute further tool calls unless they are part of the clear-context workflow
(save-session writes, git reads, memory writes).
EOF
  fi
fi
exit 2
