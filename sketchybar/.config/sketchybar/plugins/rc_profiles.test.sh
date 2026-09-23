#!/opt/homebrew/bin/bash
# Dry-runs sketchybarrc against a mock `sketchybar` for a wide external and a
# notched laptop panel (osascript is stubbed, so this doesn't depend on which
# monitor is attached). Never run sketchybarrc directly against the live bar:
# without CONFIG_DIR it sources /colors.sh and fires real `--add item` calls.

set -uo pipefail

CFG=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/bin"
fail=0

cat >"$TMP/bin/sketchybar" <<'EOF'
#!/opt/homebrew/bin/bash
printf '%s\n' "$*" >>"$MOCK_LOG"
EOF
chmod +x "$TMP/bin/sketchybar"
ORIG_PATH=$PATH

# scenario <name> <osascript output> <front_app w> <title w/chars> <audio w/chars> <agents w>
scenario() {
  local name=$1 stub=$2 dir="$TMP/$1"
  mkdir -p "$dir/bin" "$dir/cache"
  printf '#!/opt/homebrew/bin/bash\necho "%s"\n' "$stub" >"$dir/bin/osascript"
  chmod +x "$dir/bin/osascript"

  export MOCK_LOG="$dir/calls.log"; : >"$MOCK_LOG"
  export PATH="$dir/bin:$TMP/bin:$ORIG_PATH" XDG_CACHE_HOME="$dir/cache" CONFIG_DIR="$CFG"
  /opt/homebrew/bin/bash "$CFG/sketchybarrc" >/dev/null 2>"$dir/stderr.log"
  local rc=$?

  check() {  # <description> <condition-exit-status>
    if [[ $2 -eq 0 ]]; then echo "ok   $name: $1"; else echo "FAIL $name: $1"; fail=1; fi
  }
  has() { grep -q -- "$1" "$MOCK_LOG"; }

  check "rc exits 0"                                   "$rc"
  check "no stderr"                                    "$([[ ! -s "$dir/stderr.log" ]]; echo $?)"
  check "bar is display=main"                          "$(has '^--bar display=main '; echo $?)"
  check "no item sets display="                        "$(grep -v '^--bar' "$MOCK_LOG" | grep -q -- ' display='; [[ $? -ne 0 ]]; echo $?)"
  # KNOWN: ICON_CHEVRON has been "" since the first commit, so the chevron item
  # has never drawn anything (see docs/plans/2026-09-23-sketchybar-followups.md).
  # Tolerate exactly that one so any NEW empty value still fails.
  check "no empty property values (bar chevron aside)" "$(grep -v -- '--set chevron icon= ' "$MOCK_LOG" | grep -E -q -- ' [a-z_.]+=( |$)'; [[ $? -ne 0 ]]; echo $?)"
  check "front_app width=$3"                           "$(has "front_app.*width=$3 "; echo $?)"
  check "window_title width=${4%/*} chars=${4#*/}"     "$(has "window_title.*label.max_chars=${4#*/} .*label.width=${4%/*} "; echo $?)"
  check "audio_source width=${5%/*} chars=${5#*/}"     "$(has "audio_source.*label.width=${5%/*} .*label.max_chars=${5#*/} "; echo $?)"
  check "agents label.width=$6"                        "$(has "agents.*label.width=$6 "; echo $?)"
  check "display_watch subscribed to display_change"   "$(has 'display_watch display_change system_woke'; echo $?)"
}

scenario external "2560 0"  140 380/60 200/32 420
scenario laptop   "1800 38"  80 150/24 110/16 210

# The rc backgrounds a delayed balance_pills.sh (startup); let it finish so it
# doesn't recreate the temp cache dir after cleanup.
sleep 4
exit "$fail"
