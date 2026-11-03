#!/usr/bin/env bash
# Test statusline-command.sh: ctx percent is measured against the 500K cap from
# current_usage token counts, with used_percentage x window as the fallback.

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/statusline-command.sh"

fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

dir=$(mktemp -d "${TMPDIR:-/tmp}/statusline-test.XXXXXX")
trap 'rm -rf "$dir"' EXIT
strip() { sed $'s/\033\\[[0-9;]*m//g'; }
run() { HOME="$dir" bash "$SCRIPT" <<<"$1" | strip; }

out=$(run '{"cwd":"/x","context_window":{"context_window_size":1000000,"used_percentage":25,"current_usage":{"input_tokens":10000,"cache_creation_input_tokens":40000,"cache_read_input_tokens":200000}}}')
[[ "$out" == *"ctx:50%"* ]] || fail "250000 tokens did not print ctx:50%: $out"
[[ "$out" == *"(50% left)"* ]] || fail "headroom not 50% left: $out"

out=$(run '{"cwd":"/x","context_window":{"context_window_size":1000000,"used_percentage":35}}')
[[ "$out" == *"ctx:70%"* ]] || fail "fallback 35% of 1M did not print ctx:70%: $out"

echo "statusline-cap: ok"
