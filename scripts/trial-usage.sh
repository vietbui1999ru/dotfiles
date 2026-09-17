#!/bin/sh
# trial-usage.sh — count real skill/command invocations and review decisions.
#
# Sources:
#   ~/.claude/projects/**/*.jsonl       Claude Skill-tool invocations
#   ~/.pi/agent/sessions/**/*.jsonl     exact Pi user slash commands
#   project decision artifacts           extension-specific review usage
#
# Usage: trial-usage.sh <name>
# The total combines Claude Skill uses, exact Pi command uses, and matching
# decision artifacts. `/judge` never counts `/judge-report`.

set -eu

NAME="${1:?usage: trial-usage.sh <name>}"
if [ "$#" -ne 1 ]; then
	echo "usage: trial-usage.sh <name>" >&2
	exit 2
fi

COUNTS=$(python3 - "$NAME" "$HOME" <<'PY'
import json
import os
import re
import sys
from pathlib import Path

name = sys.argv[1]
home = Path(sys.argv[2])
claude_root = home / ".claude" / "projects"
pi_root = home / ".pi" / "agent" / "sessions"

claude = 0
if claude_root.is_dir():
    needle = f'"skill":"{name}"'
    for path in claude_root.rglob("*.jsonl"):
        try:
            with path.open(errors="replace") as stream:
                claude += sum(needle in line for line in stream)
        except OSError:
            pass

pi = 0
command = re.compile(rf"^\s*/{re.escape(name)}(?:\s|$)")
if pi_root.is_dir():
    for path in pi_root.rglob("*.jsonl"):
        try:
            with path.open(errors="replace") as stream:
                for line in stream:
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    message = entry.get("message", {})
                    if message.get("role") != "user":
                        continue
                    for part in message.get("content", []):
                        if part.get("type") == "text" and command.match(part.get("text", "")):
                            pi += 1
                            break
        except OSError:
            pass

roots = [home / "dotfiles", home / "repos"]
artifacts = 0
if name in {"pi-diff-review", "diff-review"}:
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("decisions.jsonl"):
            if path.parent.name != "diff-review" or path.parent.parent.name != ".pi":
                continue
            try:
                with path.open(errors="replace") as stream:
                    artifacts += sum(bool(line.strip()) for line in stream)
            except OSError:
                pass
elif name == "agent-review":
    for root in roots:
        if not root.is_dir():
            continue
        for path in root.rglob("*.json"):
            if path.parent.name == "decisions" and path.parent.parent.name == "agent-review" and path.parent.parent.parent.name == ".pi":
                artifacts += 1

print(f"claude: {claude}")
print(f"pi: {pi}")
print(f"decisions: {artifacts}")
print(f"total: {claude + pi + artifacts}")
PY
)
printf '%s\n' "$COUNTS"
