#!/usr/bin/env bash
# PostToolUse hook — design-slop reporter on Write/Edit/MultiEdit.
#
# On a UI write (css scss html tsx jsx vue svelte mdx), grep the file with each
# non-"none" pattern from the design-slop register(s) and print any matches.
# Once per session it also prints a short taste/register reminder. Advisory: the
# validator reports, it never blocks — this script always exits 0.

INPUT=$(cat)
FILE=$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // ""' 2>/dev/null)
SESSION_ID=$(printf '%s' "$INPUT" | jq -r '.session_id // ""' 2>/dev/null)

[ -z "$FILE" ] && exit 0
[ ! -f "$FILE" ] && exit 0

case "${FILE##*.}" in
  css|scss|html|tsx|jsx|vue|svelte|mdx) : ;;
  *) exit 0 ;;
esac

# Resolve the script's real path (follows the ~/.claude symlink), then locate the
# global register and taste file next to the dotfiles repo root.
SCRIPT_PATH=$(realpath "${BASH_SOURCE[0]}" 2>/dev/null || printf '%s' "${BASH_SOURCE[0]}")
SCRIPT_DIR=$(dirname "${SCRIPT_PATH}")
GLOBAL_REG="${DESIGN_SLOP_FILE:-${SCRIPT_DIR}/../../../shared/design/design-slop.md}"
TASTE_FILE="${DESIGN_TASTE_FILE:-${SCRIPT_DIR}/../../../shared/design/taste.md}"

# Walk up from the written file to find a project-level register, if any.
PROJECT_REG=""
DIR=$(dirname "$(realpath "$FILE" 2>/dev/null || printf '%s' "$FILE")")
while [[ "$DIR" != "/" && "$DIR" != "${HOME}" ]]; do
  if [[ -f "$DIR/.claude/design-slop.md" ]]; then
    PROJECT_REG="$DIR/.claude/design-slop.md"
    break
  fi
  DIR=$(dirname "$DIR")
done

MATCHES=""
TITLES=""

collect() {
  local reg="$1"
  [[ -f "$reg" ]] || return 0
  local t
  t=$(grep -E '^##[[:space:]]' "$reg" 2>/dev/null | sed -E 's/^##[[:space:]]*//')
  [[ -n "$t" ]] && TITLES="${TITLES}${TITLES:+$'\n'}${t}"
  local pat
  while IFS= read -r pat; do
    [[ "$pat" == "none" ]] && continue
    [[ -n "$pat" ]] || continue
    local m
    # Case-sensitive on purpose: -i made "Inter" match "pointer".
    m=$(grep -nE -- "$pat" "$FILE" 2>/dev/null)
    [[ -n "$m" ]] && MATCHES="${MATCHES}${MATCHES:+$'\n'}${m}"
  done < <(grep -E '^[[:space:]]*-?[[:space:]]*pattern:[[:space:]]*' "$reg" 2>/dev/null | sed -E 's/^[[:space:]]*-?[[:space:]]*pattern:[[:space:]]*//')
}

collect "$GLOBAL_REG"
collect "$PROJECT_REG"

OUT=""
if [[ -n "$MATCHES" ]]; then
  OUT=$(printf 'design-slop: %s\n%s\n' "$FILE" "$MATCHES")
fi

# Once-per-session reminder: taste (first 20 lines) + register entry titles.
if [[ -n "$SESSION_ID" ]]; then
  SENTINEL="${TMPDIR:-/tmp}/design-brief/${SESSION_ID}.reminded"
  if [[ ! -e "$SENTINEL" ]]; then
    mkdir -p "$(dirname "$SENTINEL")" 2>/dev/null || true
    if [[ -f "$TASTE_FILE" ]]; then
      OUT="${OUT}${OUT:+$'\n'}design-brief reminder (first UI write this session):"$'\n'"$(head -n 20 "$TASTE_FILE" 2>/dev/null)"
    fi
    if [[ -n "$TITLES" ]]; then
      OUT="${OUT}${OUT:+$'\n'}design-slop register entries:"$'\n'"${TITLES}"
    fi
    touch "$SENTINEL" 2>/dev/null || true
  fi
fi

# PostToolUse plain stdout only reaches the debug log; additionalContext is
# what Claude actually sees next to the tool result.
if [[ -n "$OUT" ]]; then
  jq -n --arg c "$OUT" \
    '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $c}}'
fi

exit 0
