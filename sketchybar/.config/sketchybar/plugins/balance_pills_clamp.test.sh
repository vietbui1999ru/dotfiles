#!/opt/homebrew/bin/bash
# Regression: balance_pills.sh must not pad the narrower pill past what fits on
# the main display (screen - 2*margin - notch, split between the two pills).

set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/cfg"

cat >"$TMP/bin/sketchybar" <<'EOF'
#!/opt/homebrew/bin/bash
printf '%s\n' "$*" >>"$MOCK_LOG"
if [[ "$1" == "--query" ]]; then
  w=$LW; [[ "$2" == "right_pill" ]] && w=$RW
  echo "{\"bounding_rects\":{\"display-1\":{\"size\":[$w,37]}}}"
fi
EOF
chmod +x "$TMP/bin/sketchybar"

export PATH="$TMP/bin:$PATH" TMPDIR="$TMP" XDG_CACHE_HOME="$TMP/cache" CONFIG_DIR="$TMP/cfg"
export MOCK_LOG="$TMP/mock.log"

# run <label> <screen_w> <notch_w> <lw> <rw> <expected spacer --set line, or "none">
run() {
  local label=$1 screen=$2 notch=$3 expect=$6
  printf 'SCREEN_W=%s\nBAR_MARGIN=7\nNOTCH_W=%s\n' "$screen" "$notch" >"$TMP/cfg/profile.sh"
  : >"$MOCK_LOG"
  LW=$4 RW=$5 "$ROOT/balance_pills.sh"
  # Drop the always-present "zero both spacers" call; what remains is the pad.
  local pad
  pad=$(grep -E -- '--set (left|right)_spacer width=[0-9]+$' "$MOCK_LOG" | grep -v 'width=0 --set' || true)
  if [[ "$expect" == none ]]; then
    [[ -z "$pad" ]] || { echo "FAIL $label: expected no padding, got: $pad"; exit 1; }
  else
    [[ "$pad" == "--set $expect" ]] || { echo "FAIL $label: expected '--set $expect', got '$pad'"; exit 1; }
  fi
  echo "ok   $label"
}

# limit = (screen - 14 - notch) / 2
run "fits: pad the narrow pill fully"          2560   0 300  200 "right_spacer width=100"
run "clamped: stop at limit (793)"             1800 200 1000 200 "right_spacer width=593"
run "both over limit: nothing to pad"          1800 200  900 850 none
run "right wider, fits: pad the left pill"     2560   0 200  350 "left_spacer width=150"
