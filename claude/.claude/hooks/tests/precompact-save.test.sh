#!/usr/bin/env bash
# Test precompact-save.sh: manual compaction passes, the first auto compaction
# with a stale save is blocked, the second passes, and a fresh save passes.

HOOK="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/precompact-save.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

dir=$(mktemp -d "${TMPDIR:-/tmp}/precompact-test.XXXXXX")
trap 'rm -rf "$dir"' EXIT
export PRECOMPACT_STATE_DIR="$dir/state"
repo="$dir/repo"
git init -q -b main "$repo"
mkdir -p "$repo/.claude"

run_hook() { printf '{"session_id":"%s","cwd":"%s","trigger":"%s"}' "$1" "$repo" "$2" | "$HOOK"; }

[ -z "$(run_hook s1 manual)" ] || fail "blocked a manual compaction"

out=$(run_hook s1 auto)
printf '%s' "$out" | jq -e '.decision == "block"' >/dev/null || fail "first auto compaction not blocked: $out"
[ -z "$(run_hook s1 auto)" ] || fail "second auto compaction blocked"

: > "$repo/.claude/session-state.md"
[ -z "$(run_hook s2 auto)" ] || fail "blocked although state was saved just now"

touch -t 202001010000 "$repo/.claude/session-state.md"
run_hook s3 auto | jq -e '.decision == "block"' >/dev/null || fail "stale save not blocked"

echo "precompact-save: ok"
