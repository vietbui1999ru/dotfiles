#!/usr/bin/env bash
# PreCompact hook: before the first auto compaction of a session (at the 500K
# window), block it once so Claude runs save-session, unless state was saved in
# the last 5 minutes. The second attempt always goes through, so a session can
# never be held up until it reaches the model's 1M limit.

input=$(cat)
field() { printf '%s' "$input" | jq -r --arg k "$1" '.[$k] // empty' 2>/dev/null; }

[ "$(field trigger)" = "auto" ] || exit 0

session=$(field session_id)
[ -n "$session" ] || exit 0
marker_dir="${PRECOMPACT_STATE_DIR:-$HOME/.claude/state/precompact-blocked}"
marker="$marker_dir/$session"
[ -e "$marker" ] && exit 0

# session-state.md lives in the main checkout, as session-band's resolveRepo expects.
cwd=$(field cwd)
common=$(git -C "${cwd:-.}" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)
repo=${common:+$(dirname "$common")}
state="${repo:-${cwd:-.}}/.claude/session-state.md"
[ -n "$(find "$state" -mmin -5 2>/dev/null)" ] && exit 0

mkdir -p "$marker_dir" && : > "$marker"
jq -n '{decision: "block", reason: "Context reached the 500K auto-compact window. Run the save-session skill now, then tell the user to /clear (or let the next auto-compact run). This hook blocks compaction only once per session."}'
