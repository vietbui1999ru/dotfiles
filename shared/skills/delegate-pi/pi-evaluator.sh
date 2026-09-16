#!/usr/bin/env bash
# Council evaluator seam: invokes pi/Codex for one dimension, emits VOTE:/REASON: for bin/council to parse.

set -euo pipefail

prompt_file="${1:?usage: pi-evaluator.sh <prompt-file> <dimension>}"
dimension="${2:?usage: pi-evaluator.sh <prompt-file> <dimension>}"

"$HOME/.claude/skills/delegate-pi/pi-router.sh" council "$dimension" -p "$(cat <<EOF
You are a code reviewer evaluating the '${dimension}' dimension of a diff.
Read the diff below and reply with EXACTLY two lines:
  VOTE: PASS
or
  VOTE: FAIL
Then optionally a third line:
  REASON: <one concise sentence explaining the vote>

No other output. No preamble. No markdown.

Diff:
$(cat "$prompt_file")
EOF
)" \
  --no-session --no-extensions --no-skills \
  2>/dev/null
