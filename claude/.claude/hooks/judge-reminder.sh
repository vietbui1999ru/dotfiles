#!/usr/bin/env bash
# PostToolUse hook — remind Claude to run /judge after substantial code output.
# Fires after Write/Edit/MultiEdit. Checks if a code file was written with
# enough lines to warrant evaluation. Informational — does not force continuation.

INPUT=$(cat)
TOOL=$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_input.path // ""' 2>/dev/null)

[ -z "$FILE" ] && exit 0

# Only trigger for code files (not markdown, config, json, yaml)
if ! echo "$FILE" | grep -qE '\.(py|ts|tsx|js|jsx|go|rs|java|kt|swift|cs|cpp|c|h|sh|rb|php)$'; then
  exit 0
fi

# Count lines written (new_string for Edit, content for Write)
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // .tool_input.content // ""' 2>/dev/null)
LINE_COUNT=$(echo "$CONTENT" | wc -l | tr -d ' ')

# Threshold: 25+ lines in a single write
if [ "$LINE_COUNT" -lt 25 ]; then
  exit 0
fi

echo ""
echo "JUDGE-REMINDER: ${LINE_COUNT} lines written to $(basename "$FILE"). Run /judge to evaluate this turn's implementation."
echo ""

exit 0
