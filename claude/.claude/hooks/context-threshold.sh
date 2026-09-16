#!/usr/bin/env bash
# Context threshold hook (70%+) — single script for PreToolUse and PostToolUse.
# Merged from context-threshold-check.sh (PreToolUse) and
# context-threshold-notify.sh (PostToolUse), which both fired on every tool
# call and independently re-derived the same cached percentage.
#
# PreToolUse: hard-block Agent spawns only; all other tools pass through so
# save workflows are never interrupted.
# PostToolUse: emit the SOFT STOP directive once per threshold crossing, with
# per-agent flag namespacing, save-critical exemptions, and a post-save
# debounce.

INPUT=$(cat)

# Shared derivation — hook stdin first, statusline cache fallback (5-min window).
CACHE_FILE="$HOME/.claude/state/statusline-context.json"
CTX_PCT=$(echo "$INPUT" | jq -r '.context_window.used_percentage // empty' 2>/dev/null)
if [[ -z "$CTX_PCT" && -f "$CACHE_FILE" ]]; then
  UPDATED_AT=$(jq -r '.updated_at // 0' "$CACHE_FILE" 2>/dev/null)
  NOW=$(date +%s)
  if [[ "$UPDATED_AT" =~ ^[0-9]+$ ]] && (( NOW - UPDATED_AT <= 300 )); then
    CTX_PCT=$(jq -r '.used_percentage // empty' "$CACHE_FILE" 2>/dev/null)
  fi
fi

# Not available — silently pass.
[[ -z "$CTX_PCT" ]] && exit 0

CTX_INT=$(printf "%.0f" "$CTX_PCT" 2>/dev/null || echo "0")

# Below threshold (PostToolUse): clear this context's notify flag and pass.
EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // empty' 2>/dev/null)
if [[ "$CTX_INT" -lt 70 ]]; then
  if [[ "$EVENT" == "PostToolUse" ]]; then
    TASK_ID_CLEAR=$(cat "$(git rev-parse --show-toplevel 2>/dev/null)/.agent-task-id" 2>/dev/null)
    if [[ -n "$TASK_ID_CLEAR" ]]; then
      rm -f "$HOME/.claude/state/ctx-notified-${TASK_ID_CLEAR}"
    else
      rm -f "$HOME/.claude/state/ctx-notified"
    fi
  fi
  exit 0
fi

# ── PreToolUse: only block Agent spawns at threshold ────────────────────────
if [[ "$EVENT" != "PostToolUse" ]]; then
  TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty' 2>/dev/null)
  if [[ "$TOOL_NAME" == "Agent" ]]; then
    cat <<'EOF'
CONTEXT THRESHOLD (70%+): Agent spawns are blocked at this context level.
Save session state (save-session skill) and clear context first, then retry.
EOF
    exit 2
  fi
  exit 0
fi

# ── PostToolUse: soft-stop directive ────────────────────────────────────────

# Resolve agent context — before flag naming and message routing.
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

# Step 2: Recent-save debounce — prevent false re-fire after a clear when the
# cache is stale. Matches the 5-min statusline cache window.
if [[ -f "$SESSION_STATE" ]]; then
  LAST_SAVED=$(stat -f "%m" "$SESSION_STATE" 2>/dev/null || stat -c "%Y" "$SESSION_STATE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  if (( NOW - LAST_SAVED <= 300 )); then
    exit 0  # save ran within last 5 min — likely a post-clear false positive
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
CONTEXT SOFT STOP (still 70%+): Save session state, then ask the user to clear context before continuing.
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

1. Invoke the save-session skill now to persist progress.
2. Then ask the user to clear or compact context before further work.

Do not execute further tool calls unless they are part of saving session state
(save-session writes, git reads, memory writes).
EOF
  fi
fi
exit 2
