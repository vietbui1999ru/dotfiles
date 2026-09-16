#!/bin/sh
# trial-usage.sh — count recorded invocations of a named skill/extension/command
# across agent session transcripts.
#
# Sources and what counts as one invocation:
#   ~/.claude/projects/**/*.jsonl   Claude Code: a Skill tool_use whose input
#                                   names the skill ("skill":"<name>").
#   ~/.pi/agent/sessions/**/*.jsonl Pi: a user message invoking the command
#                                   ("/<name> ..." or the bare exact name).
#
# Mentions inside system prompts, skill listings, thinking, and assistant prose
# are deliberately NOT counted — only recorded invocations.
#
# Usage: trial-usage.sh <name>
# Prints per-source counts and a total.

set -eu

NAME="${1:?usage: trial-usage.sh <name>}"
if [ "$#" -ne 1 ]; then
	echo "usage: trial-usage.sh <name>" >&2
	exit 2
fi

CLAUDE_ROOT="$HOME/.claude/projects"
PI_ROOT="$HOME/.pi/agent/sessions"

count_claude() {
	[ -d "$CLAUDE_ROOT" ] || { echo 0; return; }
	find "$CLAUDE_ROOT" -name '*.jsonl' -type f -print0 2>/dev/null |
		xargs -0 grep -h -c -F "\"skill\":\"$NAME\"" 2>/dev/null |
		awk '{ total += $1 } END { print total + 0 }'
}

count_pi() {
	[ -d "$PI_ROOT" ] || { echo 0; return; }
	find "$PI_ROOT" -name '*.jsonl' -type f -print0 2>/dev/null |
		xargs -0 grep -h -F '"role":"user"' 2>/dev/null |
		grep -c -F -e "\"text\":\"/$NAME" -e "\"text\":\"$NAME\"" 2>/dev/null ||
		true
}

CLAUDE_COUNT=$(count_claude "$CLAUDE_ROOT")
PI_COUNT=$(count_pi "$PI_ROOT")

echo "claude: $CLAUDE_COUNT"
echo "pi: $PI_COUNT"
echo "total: $((CLAUDE_COUNT + PI_COUNT))"
