#!/usr/bin/env bash
# Stop hook — biome autofix + session quality summary + event log.
# Runs biome check --write on the project if linting: enabled in profile.md.
# Safe to run here (not PostToolUse) — no file-state conflict with CC's Edit tool.

REPO_ROOT=$(git rev-parse --show-toplevel 2>/dev/null)

# ── Biome autofix ─────────────────────────────────────────────────────────────
LINTING=$(grep "^linting:" .claude/profile.md 2>/dev/null | cut -d: -f2 | tr -d ' ')
if [[ "$LINTING" == "enabled" ]]; then
  BIOME=""
  command -v biome &>/dev/null && BIOME="biome"
  [[ -z "$BIOME" && -f "node_modules/.bin/biome" ]] && BIOME="node_modules/.bin/biome"

  if [[ -n "$BIOME" ]]; then
    CHANGED=$(git diff --name-only HEAD 2>/dev/null && git ls-files --others --exclude-standard 2>/dev/null)
    TS_FILES=$(echo "$CHANGED" | grep -E '\.(ts|tsx|js|jsx)$' || true)
    if [[ -n "$TS_FILES" ]]; then
      echo "biome autofix:"
      echo "$TS_FILES" | xargs "$BIOME" check --write 2>&1
    fi
  fi
fi

# ── Session quality summary + event log ───────────────────────────────────────
SESSION_ID="${CLAUDE_SESSION_ID:-$(date +%s)}"
SESSION_SHORT="${SESSION_ID:0:8}"
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Count files changed in this session
FILE_COUNT=$(git diff --name-only HEAD 2>/dev/null | grep -c . || echo 0)

echo ""
echo "── Session summary [$SESSION_SHORT] ──────────────────────────"
echo "  Files changed: ${FILE_COUNT}"
echo "──────────────────────────────────────────────────────────────"

# Append to .agents/events.jsonl if this repo has .agents/ dir
if [[ -n "$REPO_ROOT" && -d "${REPO_ROOT}/.agents" ]]; then
  EVENT="{\"ts\":\"${TS}\",\"event\":\"session_end\",\"session\":\"${SESSION_ID}\",\"files_changed\":${FILE_COUNT}}"
  echo "$EVENT" >> "${REPO_ROOT}/.agents/events.jsonl"
fi

exit 0
