#!/opt/homebrew/bin/bash
# Gauge icon colored by the worst live quota, plus the popup rows, from one
# `claude-tui status --json` call (contract: claude-tui docs/status-json.md).
# Absolute binary path because sketchybar's PATH lacks ~/.cargo/bin;
# CLAUDE_TUI_BIN overrides it for tests. A click refreshes, then toggles.

source "$CONFIG_DIR/colors.sh"
BIN=${CLAUDE_TUI_BIN:-$HOME/.cargo/bin/claude-tui}

# Line 1: worst live used_pct (-1 when none). Lines 2-4: Claude, ChatGPT, OpenCode.
read -r -d '' PROG <<'JQ'
def money: if . >= 10 then "$\(round)"
  else (. * 100 | round) as $c | "$\($c / 100 | floor).\($c % 100 | if . < 10 then "0\(.)" else tostring end)" end;
def cost: if . == null or .cost_usd == null then "?"
  else (if .cost_source == "computed" then "≈" else "" end) + (.cost_usd | money) end;
def live: .quota // [] | map(select(.stale | not) | select(.expired | not) | select(.used_pct != null));
def wins: .quota // [] | map(select(.expired | not) | select(.used_pct != null)
  | ({five_hour: "5h", primary: "5h", seven_day: "wk", secondary: "wk"}[.window] // .window)
    + " \(.used_pct | round)%" + (if .stale then "?" else "" end)) | join("  ");
def row($name): ($name + "         ")[0:9] + (if . == null then "no data"
  else ([wins, "today \(.today | cost)", "7d \(.last_7d | cost)"] | map(select(. != "")) | join("  ")) end);
.subscriptions as $s
| ([$s[] | select(. != null) | live[] | .used_pct] | max // -1 | round),
  ($s.claude | row("Claude")), ($s.chatgpt | row("ChatGPT")), ($s["opencode-go"] | row("OpenCode"))
JQ

json=$("$BIN" status --json 2>/dev/null)
if [[ -z "$json" ]] || jq -e '.daemon == "down"' <<<"$json" >/dev/null 2>&1; then
  rows=(-1 "usage: daemon down" "" "")
else
  mapfile -t rows < <(jq -r "$PROG" <<<"$json" 2>/dev/null)
  [[ ${#rows[@]} -eq 4 ]] || rows=(-1 "usage: unreadable status" "" "")
fi

worst=${rows[0]}
if   (( worst < 0 ));  then color=$MUTED_TEAL
elif (( worst >= 90 )); then color=$USAGE_CRIT_COLOR
elif (( worst >= 70 )); then color=$USAGE_WARN_COLOR
else                         color=$USAGE_OK_COLOR
fi

args=(--set claude_usage icon.color="$color")
for i in 1 2 3; do
  name=(claude chatgpt opencode); name=claude_usage.${name[i-1]}
  [[ -n "${rows[i]}" ]] && args+=(--set "$name" drawing=on label="${rows[i]}") || args+=(--set "$name" drawing=off)
done
[[ "$SENDER" == "mouse.clicked" ]] && args+=(--set claude_usage.popup popup.drawing=toggle)
sketchybar "${args[@]}"
