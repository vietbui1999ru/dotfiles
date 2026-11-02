#!/usr/bin/env bash
# PostToolUse hook — append {ts, tool, session, ok, model, effort} to session JSONL log.
# Never blocks (always exits 0). Log path: ~/.claude/logs/session-YYYYMMDD.jsonl

INPUT=$(cat)

TOOL=$(echo "$INPUT" | jq -r '.tool_name // "unknown"' 2>/dev/null)
SESSION=$(echo "$INPUT" | jq -r '.session_id // "unknown"' 2>/dev/null)
# tool_response is an object; presence of error key or non-zero exit signals failure
OK=true
if echo "$INPUT" | jq -e '.tool_response.error' &>/dev/null; then
	OK=false
fi

# Model and effort for provenance: the provenance writer also appends ledger rows for
# apply_patch edits and prints "model<TAB>effort" (unknown when not observable).
PROVENANCE_BIN=${PROVENANCE_BIN:-$HOME/dotfiles/scripts/provenance}
MODEL=unknown
EFFORT=unknown
IFS=$'\t' read -r MODEL EFFORT < <(printf '%s' "$INPUT" | "$PROVENANCE_BIN" codex 2>/dev/null)
MODEL=${MODEL:-unknown}
EFFORT=${EFFORT:-unknown}

LOG_DIR="$HOME/.claude/logs"
mkdir -p "$LOG_DIR"
LOG_FILE="$LOG_DIR/session-$(date -u +%Y%m%d).jsonl"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
printf '{"ts":"%s","tool":"%s","session":"%s","ok":%s,"model":"%s","effort":"%s"}\n' \
	"$TS" "$TOOL" "$SESSION" "$OK" "$MODEL" "$EFFORT" >>"$LOG_FILE"

# Universal inbox: also save to .agents/sessions/ via agent-session (lightweight,
# non-blocking; best-effort — never fails the hook). Keeps Codex sessions in the
# same universal inbox as cc/opencode/pi. Legacy logging above is unchanged.
if command -v agent-session >/dev/null 2>&1; then
	STATE_BODY="## Session log entry\n- ts: $TS\n- tool: $TOOL\n- session: $SESSION\n- ok: $OK\n- model: $MODEL\n- effort: $EFFORT\n"
	printf '%s' "$STATE_BODY" | agent-session save --harness codex --work-type general --kind session --goal "codex session $SESSION" --body - >/dev/null 2>&1 || true
fi

exit 0
