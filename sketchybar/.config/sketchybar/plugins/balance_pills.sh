#!/opt/homebrew/bin/bash
# Equalize left_pill/right_pill widths. Called after any event that can
# change either pill's content width (workspace change, VPN state) —
# a single startup correction goes stale as soon as content changes.
#
# aerospace_workspace_change broadcasts to all 14 space.* items at once,
# so this can run 14x concurrently per event — the sleep lets sibling
# --set calls land before this measures, avoiding a stale-width race.
sleep 0.15

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

if (( lw > rw )); then
  sketchybar --set right_spacer width=$diff
elif (( rw > lw )); then
  sketchybar --set left_spacer width=$diff
fi
