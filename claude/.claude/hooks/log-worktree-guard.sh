#!/bin/sh
# PostToolUseFailure hook: log a refusal by Claude Code's built-in worktree guard to the safety log.
#
# The built-in guard refuses a Bash command in a worktree-isolated session (for example `git -C ~`).
# Claude Code 2.1.317 fires PostToolUseFailure for that refusal, with the refusal text in `error`.
# This hook records it as a `noted` entry for a human to review with scripts/safety-log
# (docs/workflows/bash-safety-log.md). It only observes: it never blocks, never prints to stdout,
# and always exits 0, so a failed write changes nothing for the agent.

input=$(cat) || exit 0
tool=$(printf '%s' "$input" | jq -r '.tool_name // ""' 2>/dev/null) || exit 0
interrupt=$(printf '%s' "$input" | jq -r '.is_interrupt // false' 2>/dev/null) || exit 0
error=$(printf '%s' "$input" | jq -r '.error // ""' 2>/dev/null) || exit 0

[ "$tool" = Bash ] || exit 0
[ "$interrupt" = true ] && exit 0
case "$error" in *"is isolated in the worktree"*) ;; *) exit 0 ;; esac

first=$(printf '%s\n' "$error" | head -n 1)
command=$(printf '%s' "$input" | jq -r '.tool_input.command // ""' 2>/dev/null)
session=$(printf '%s' "$input" | jq -r '.session_id // ""' 2>/dev/null)
cwd=$(printf '%s' "$input" | jq -r '.cwd // ""' 2>/dev/null)
transcript=$(printf '%s' "$input" | jq -r '.transcript_path // ""' 2>/dev/null)

python3 "$HOME/dotfiles/scripts/safety-log" record --noted --rule worktree-guard \
  --reason "$first" --command "$command" --session "$session" --cwd "$cwd" --transcript "$transcript" \
  >/dev/null 2>&1 || true
exit 0
