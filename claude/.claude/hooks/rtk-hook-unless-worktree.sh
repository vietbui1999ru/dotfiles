#!/usr/bin/env bash
# PreToolUse hook — run `rtk hook claude` except inside Claude Code managed worktrees.
# Bandaid for rtk-ai/rtk#3864: the worktree-isolation guard refuses the rewritten
# `rtk git …`. rtk PR #3879 fixes this upstream; remove this wrapper (and point
# settings.json back at `rtk hook claude`) once a stable rtk release ships it.
# See docs/workflows/worktree-guard-bandaid.md.

INPUT=$(cat)
CWD=$(printf '%s' "$INPUT" | jq -r '.cwd // ""' 2>/dev/null)

case "$CWD" in
  */.claude/worktrees/*) exit 0 ;;
esac

printf '%s' "$INPUT" | exec rtk hook claude
