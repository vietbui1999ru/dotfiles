#!/usr/bin/env bash
# PostToolUse hook — read-only lint reporter on Write/Edit/MultiEdit.
# Always-on: shellcheck (.sh), jq (.json)
# Per-project: biome check (.ts/.tsx/.js/.jsx) when linting: enabled in profile.md
# Exit 0 always — this is advisory. Pre-commit is the hard gate.

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)

[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

EXT="${FILE##*.}"

# Always-on: shellcheck for shell scripts
if [[ "$EXT" == "sh" || "$EXT" == "bash" ]]; then
  if command -v shellcheck &>/dev/null; then
    OUT=$(shellcheck --severity=warning "$FILE" 2>&1)
    [ -n "$OUT" ] && echo "shellcheck: $FILE" && echo "$OUT"
  fi
  exit 0
fi

# Always-on: jq syntax check for JSON
if [[ "$EXT" == "json" ]]; then
  if command -v jq &>/dev/null; then
    OUT=$(jq . "$FILE" > /dev/null 2>&1; echo $?)
    [ "$OUT" != "0" ] && echo "JSON syntax error:" && jq . "$FILE" 2>&1
  fi
  exit 0
fi

# Per-project: biome check for TypeScript/JavaScript (report only — no writes)
if [[ "$EXT" == "ts" || "$EXT" == "tsx" || "$EXT" == "js" || "$EXT" == "jsx" ]]; then
  # Walk up to find .claude/profile.md
  DIR=$(dirname "$(realpath "$FILE" 2>/dev/null || echo "$FILE")")
  PROJECT_ROOT=""
  while [[ "$DIR" != "/" && "$DIR" != "$HOME" ]]; do
    if [[ -f "$DIR/.claude/profile.md" ]]; then
      PROJECT_ROOT="$DIR"
      break
    fi
    DIR=$(dirname "$DIR")
  done

  [ -z "$PROJECT_ROOT" ] && exit 0

  LINTING=$(grep "^linting:" "$PROJECT_ROOT/.claude/profile.md" 2>/dev/null | cut -d: -f2 | tr -d ' ')
  [[ "$LINTING" != "enabled" ]] && exit 0

  BIOME=""
  command -v biome &>/dev/null && BIOME="biome"
  [[ -z "$BIOME" && -f "$PROJECT_ROOT/node_modules/.bin/biome" ]] && BIOME="$PROJECT_ROOT/node_modules/.bin/biome"
  [ -z "$BIOME" ] && exit 0

  OUT=$("$BIOME" check "$FILE" 2>&1)
  [ -n "$OUT" ] && echo "biome: $FILE" && echo "$OUT"
fi

exit 0
