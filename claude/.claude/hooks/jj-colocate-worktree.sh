#!/usr/bin/env bash
# PreToolUse hook (Bash) — colocate jj in a Claude Code managed worktree on first use.
# The worktree-isolation guard refuses every `jj git …` command typed in Bash,
# so a session cannot run `jj git init --colocate` itself. Hooks run outside the
# guard, so this one does it once per worktree. Always exits 0 with no output.
# See docs/workflows/worktree-guard-bandaid.md ("jj in worktree sessions").

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)

case "$CWD" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac

command -v jj >/dev/null 2>&1 || exit 0
ROOT=$(git -C "$CWD" rev-parse --show-toplevel 2>/dev/null) || exit 0
case "$ROOT" in
  */.claude/worktrees/*) ;;
  *) exit 0 ;;
esac
[ -e "$ROOT/.jj" ] && exit 0

(cd "$ROOT" && jj git init --colocate >/dev/null 2>&1)
exit 0
