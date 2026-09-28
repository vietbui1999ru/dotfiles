#!/opt/homebrew/bin/bash
# aerospace.sh with the bar on the target display only: a workspace whose
# windows are on that display's NSScreen index (profile.sh's
# MAIN_NSSCREEN_IDX) draws, one on another monitor hides, and nothing passes
# an NSScreen index to sketchybar's display=.

set -uo pipefail

CFG=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin" "$TMP/cache"
fail=0

cat >"$TMP/bin/sketchybar" <<'EOF'
#!/opt/homebrew/bin/bash
printf '%s\n' "$*" >>"$MOCK_LOG"
EOF
cat >"$TMP/bin/aerospace" <<'EOF'
#!/opt/homebrew/bin/bash
case "$1 $2" in
  "list-workspaces --focused") echo "B" ;;
  "list-windows --workspace")
    printf '[{"monitor-appkit-nsscreen-screens-id": %s, "app-name": "Firefox"}]\n' "$MON" ;;
esac
EOF
chmod +x "$TMP/bin/"*

export PATH="$TMP/bin:$PATH" XDG_CACHE_HOME="$TMP/cache" TMPDIR="$TMP" CONFIG_DIR="$CFG"
export MOCK_LOG="$TMP/calls.log"

# check <label> <monitor> <workspace> <grep pattern> <want: yes|no>
check() {
  : >"$MOCK_LOG"
  MON=$2 NAME=space.$3 SENDER=aerospace_workspace_change \
    /opt/homebrew/bin/bash "$CFG/plugins/aerospace.sh" "$3" >/dev/null 2>&1
  local got=no; grep -q -- "$4" "$MOCK_LOG" && got=yes
  if [[ "$got" == "$5" ]]; then echo "ok   $1"
  else echo "FAIL $1 (pattern '$4' present=$got, want $5)"; cat "$MOCK_LOG"; fail=1; fi
}

check "main screen, focused workspace draws"        1 B "drawing=on"           yes
check "main screen: no display= passed"             1 B "display="             no
check "other monitor, focused workspace is hidden"  2 B "space.B drawing=off"  yes
check "other monitor, unfocused: never draws"       2 T "drawing=on"           no

# MAIN_NSSCREEN_IDX=1 above is profile.sh's fallback default when no cache
# exists — it doesn't prove aerospace.sh actually reads the variable. Point
# the cache at an arbitrary non-1 target (3) and confirm the "main" screen
# moves with it.
mkdir -p "$TMP/cache/sketchybar"
printf 'MAIN_NSSCREEN_IDX=3\n' > "$TMP/cache/sketchybar/profile"
check "cached idx=3: that screen draws"             3 B "drawing=on"           yes
check "cached idx=3: old default (1) now hides"     1 B "space.B drawing=off"  yes

exit "$fail"
