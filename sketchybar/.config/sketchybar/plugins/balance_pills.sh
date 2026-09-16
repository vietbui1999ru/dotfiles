#!/opt/homebrew/bin/bash
# Equalize left_pill/right_pill widths. Called after any event that can
# change either pill's content width (workspace change, VPN state) —
# a single startup correction goes stale as soon as content changes.
#
# aerospace_workspace_change broadcasts to all 14 space.* items at once,
# so this runs 14x concurrently per event. Two problems follow from that:
#  1. Debounce — only the LAST of the 14 should actually measure, so it
#     sees every sibling's --set already landed instead of a half-updated
#     pill. Each invocation stamps a generation token, waits, then bows
#     out if a newer invocation has since taken over.
#  2. Mutual exclusion — even the "last" invocation can still tie with
#     another one. Without a lock, one instance's zero-spacers step can
#     land between a sibling's zero and measure, producing a genuinely
#     corrupted reading (reproduced live: left_pill briefly read 444
#     against a steady 511). The lock makes zero+measure+set atomic.
# Every resize funnels through this script, so it's the single point that
# logs who triggered it — set CALLER before invoking (aerospace/vpn/agents/
# startup) to identify the source of unwanted resizing after the fact.
LOG_FILE="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/balance.log"
mkdir -p "$(dirname "$LOG_FILE")"

GEN_FILE="${TMPDIR:-/tmp}/sketchybar_balance.gen"
MY_GEN="$$-$RANDOM"
printf '%s' "$MY_GEN" > "$GEN_FILE"

sleep 0.15

# A later invocation already claimed the token — it supersedes us.
[[ "$(cat "$GEN_FILE" 2>/dev/null)" != "$MY_GEN" ]] && exit 0

LOCK_DIR="${TMPDIR:-/tmp}/sketchybar_balance.lock"
# Stale-lock guard: a crashed holder shouldn't wedge every future run.
if [[ -d "$LOCK_DIR" ]]; then
  age=$(( $(date +%s) - $(stat -f %m "$LOCK_DIR" 2>/dev/null || echo 0) ))
  (( age > 2 )) && rmdir "$LOCK_DIR" 2>/dev/null
fi
mkdir "$LOCK_DIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCK_DIR" 2>/dev/null' EXIT

pill_width() {
  sketchybar --query "$1" | /usr/bin/python3 -c "
import sys, json
try:
  d = json.load(sys.stdin)['bounding_rects']
  print(int(list(d.values())[0]['size'][0]))
except Exception:
  print(0)
" 2>/dev/null
}

# Zero both spacers before measuring — otherwise a repeat run reads a
# pill width that already includes a previous correction, and the fix
# erodes/oscillates instead of converging.
sketchybar --set left_spacer width=0 --set right_spacer width=0
sleep 0.05

lw=$(pill_width left_pill)
rw=$(pill_width right_pill)
[[ -z "$lw" || -z "$rw" ]] && exit 0

diff=$(( lw > rw ? lw - rw : rw - lw ))

action="noop"
if (( lw > rw )); then
  sketchybar --set right_spacer width=$diff
  action="right_spacer+=$diff"
elif (( rw > lw )); then
  sketchybar --set left_spacer width=$diff
  action="left_spacer+=$diff"
fi

printf '%s caller=%s lw=%s rw=%s diff=%s action=%s\n' \
  "$(date '+%Y-%m-%d %H:%M:%S')" "${CALLER:-unknown}" "$lw" "$rw" "$diff" "$action" \
  >> "$LOG_FILE"
tail -n 500 "$LOG_FILE" > "$LOG_FILE.tmp" 2>/dev/null && mv "$LOG_FILE.tmp" "$LOG_FILE"
