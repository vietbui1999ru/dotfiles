#!/opt/homebrew/bin/bash
# Regression: a balance run with nothing to fix must not --set anything (the
# old zero-then-repad cycle flickered a pill on every call); a real width
# change must produce exactly one --set.

set -euo pipefail

ROOT=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/cfg" "$TMP/state"

# Stateful mock: spacer widths persist in $STATE, and a pill's drawn width is
# its natural width (LW/RW) plus its spacer, as in the real bar.
cat >"$TMP/bin/sketchybar" <<'EOF'
#!/opt/homebrew/bin/bash
printf '%s\n' "$*" >>"$MOCK_LOG"
sp() { cat "$STATE/$1" 2>/dev/null || echo 0; }
if [[ "$1" == "--query" ]]; then
  case "$2" in
    left_pill)  echo "{\"bounding_rects\":{\"display-1\":{\"size\":[$(( LW + $(sp left_spacer) )),37]}}}" ;;
    right_pill) echo "{\"bounding_rects\":{\"display-1\":{\"size\":[$(( RW + $(sp right_spacer) )),37]}}}" ;;
    *)          echo "{\"geometry\":{\"width\":$(sp "$2")}}" ;;
  esac
  exit 0
fi
while (( $# )); do
  if [[ "$1" == --set ]]; then echo "${3#width=}" >"$STATE/$2"; shift 3; else shift; fi
done
EOF
chmod +x "$TMP/bin/sketchybar"
printf 'SCREEN_W=2560\nBAR_MARGIN=7\nNOTCH_W=0\n' >"$TMP/cfg/profile.sh"

export PATH="$TMP/bin:$PATH" TMPDIR="$TMP" XDG_CACHE_HOME="$TMP/cache" CONFIG_DIR="$TMP/cfg"
export MOCK_LOG="$TMP/mock.log" STATE="$TMP/state"

sets() { grep -c -- '--set' "$MOCK_LOG" || true; }

# run <label> <lw> <rw> <expected --set calls>
run() {
  : >"$MOCK_LOG"
  LW=$2 RW=$3 "$ROOT/balance_pills.sh"
  local n; n=$(sets)
  [[ "$n" == "$4" ]] || { echo "FAIL $1: expected $4 --set calls, got $n"; cat "$MOCK_LOG"; exit 1; }
  echo "ok   $1"
}

run "first run pads the narrow pill"     300 200 1
run "same widths again: no --set"        300 200 0
run "and again: still no --set"          300 200 0
run "left grows: one --set"              350 200 1
run "right becomes wider: one --set"     200 400 1
[[ "$(cat "$STATE/left_spacer")" == 200 && "$(cat "$STATE/right_spacer")" == 0 ]] \
  || { echo "FAIL spacers: left=$(cat "$STATE/left_spacer") right=$(cat "$STATE/right_spacer")"; exit 1; }
echo "ok   spacers converge (left=200 right=0)"
