#!/opt/homebrew/bin/bash
# Runs plugins/claude_usage.sh against a stub claude-tui (fixture JSON) and a
# stub sketchybar that logs one argument per line.
# Usage: claude_usage.test.sh icon|popup

set -uo pipefail

CFG=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
printf '#!/opt/homebrew/bin/bash\nprintf "%%s\\n" "$@" >"$MOCK_LOG"\n' >"$TMP/bin/sketchybar"
printf '#!/opt/homebrew/bin/bash\ncat "$FIXTURE"\n' >"$TMP/bin/claude-tui"
chmod +x "$TMP/bin/sketchybar" "$TMP/bin/claude-tui"
export PATH="$TMP/bin:$PATH" CONFIG_DIR="$CFG" CLAUDE_TUI_BIN="$TMP/bin/claude-tui"
export MOCK_LOG="$TMP/log" FIXTURE="$TMP/fixture.json"
source "$CFG/colors.sh"
fail=0

q() { printf '{"window":"%s","used_pct":%s,"stale":%s,"expired":%s}' "$@"; }
t() { printf '{"cost_usd":%s,"cost_source":"%s"}' "$@"; }
sub() { printf '{"quota":[%s],"today":%s,"last_7d":%s}' "$@"; }
# run <fixture json>: runs the plugin, log lands in $MOCK_LOG
run() { printf '%s' "$1" >"$FIXTURE"; /opt/homebrew/bin/bash "$CFG/plugins/claude_usage.sh"; }
check() { if grep -qxF -- "$2" "$MOCK_LOG"; then echo "ok   $1"; else echo "FAIL $1: no line '$2'"; fail=1; fi; }

claude=$(sub "$(q five_hour 19 false false),$(q seven_day 75 false false)" "$(t 99.03 computed)" "$(t 376.5 computed)")
chatgpt=$(sub "$(q primary 95 true false),$(q secondary 5 false false)" "$(t 0 reported)" "$(t 7.344 computed)")
live="{\"v\":1,\"subscriptions\":{\"claude\":$claude,\"chatgpt\":$chatgpt,\"opencode-go\":null}}"

case "${1:-}" in
  icon)
    run "$live";                           check "worst live 75% is yellow"   "icon.color=$USAGE_WARN_COLOR"
    run "${live//75/95}";                  check "worst live 95% is red"      "icon.color=$USAGE_CRIT_COLOR"
    run "${live//75/40}";                  check "stale 95% ignored, 40% green" "icon.color=$USAGE_OK_COLOR"
    run '{"v":1,"daemon":"down"}';         check "daemon down is grey"        "icon.color=$MUTED_TEAL"
    ;;
  popup)
    run "$live"
    check "Claude row"   "label=Claude   5h 19%  wk 75%  today ≈\$99  7d ≈\$377"
    check "ChatGPT row"  "label=ChatGPT  5h 95%?  wk 5%  today \$0.00  7d ≈\$7.34"
    check "OpenCode row" "label=OpenCode no data"
    run '{"v":1,"daemon":"down"}'
    check "down row"     "label=usage: daemon down"
    check "others hidden" "drawing=off"
    ;;
  *) echo "usage: $0 icon|popup"; exit 2 ;;
esac
exit $fail
