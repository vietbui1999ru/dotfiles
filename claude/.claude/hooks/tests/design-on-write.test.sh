#!/usr/bin/env bash
# Test design-on-write.sh: match (UI write reports), non_ui (silent),
# once_per_session (reminder printed once). Uses temp fixtures via the
# DESIGN_SLOP_FILE / DESIGN_TASTE_FILE overrides.

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/design-on-write.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

setup() {
  local dir
  dir=$(mktemp -d "${TMPDIR:-/tmp}/design-on-write-test.XXXXXX")
  cat > "$dir/slop.md" <<'EOF'
## Slop fixture
- pattern: DESIGN_SLOP_MARKER

## Judgement only
- pattern: none
EOF
  cat > "$dir/taste.md" <<'EOF'
# Taste

## Fonts I like
## Fonts I ban
## Palettes
## Aesthetic references
## Anti-references
EOF
  printf '.x { color: DESIGN_SLOP_MARKER; }\n' > "$dir/component.css"
  printf '%s' "$dir"
}

run_hook() {
  local dir="$1" file="$2" session="$3"
  local json
  json=$(printf '{"session_id":"%s","tool_input":{"file_path":"%s"}}' "$session" "$file")
  printf '%s' "$json" | DESIGN_SLOP_FILE="$dir/slop.md" DESIGN_TASTE_FILE="$dir/taste.md" "$HOOK"
}

case "${1:-}" in
  match)
    dir=$(setup)
    out=$(run_hook "$dir" "$dir/component.css" "match-$$")
    [[ "$out" == *"DESIGN_SLOP_MARKER"* ]] \
      || fail "match: slop marker not reported; got: ${out}"
    rm -rf "$dir"
    printf 'match: ok\n'
    ;;
  non_ui)
    dir=$(setup)
    printf '# README\n' > "$dir/README.md"
    out=$(run_hook "$dir" "$dir/README.md" "non-ui-$$")
    [[ -z "$out" ]] || fail "non_ui: expected silent, got: ${out}"
    rm -rf "$dir"
    printf 'non_ui: ok\n'
    ;;
  once_per_session)
    dir=$(setup)
    out1=$(run_hook "$dir" "$dir/component.css" "once-$$")
    out2=$(run_hook "$dir" "$dir/component.css" "once-$$")
    c1=$(printf '%s' "$out1" | grep -c 'Fonts I like' || true)
    c2=$(printf '%s' "$out2" | grep -c 'Fonts I like' || true)
    [[ "$c1" -eq 1 ]] || fail "once_per_session: reminder missing from first write; got: ${out1}"
    [[ "$c2" -eq 0 ]] || fail "once_per_session: reminder repeated on second write; got: ${out2}"
    rm -rf "$dir"
    printf 'once_per_session: ok\n'
    ;;
  *)
    printf 'usage: %s {match|non_ui|once_per_session}\n' "$0" >&2
    exit 1
    ;;
esac
