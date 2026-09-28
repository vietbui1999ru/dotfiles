#!/opt/homebrew/bin/bash
# Dry-runs sketchybarrc against a mock `sketchybar` + `osascript` for three
# screen layouts. Never run sketchybarrc directly against the live bar:
# without CONFIG_DIR it sources /colors.sh and fires real `--add item` calls.
#
# The mock `osascript` stands in for display_profile.sh's screen enumeration
# (CGDirectDisplayID, NSScreen index, width, notch inset, isBuiltin per line);
# the mock `sketchybar --query displays` stands in for the arrangement-id
# lookup. One scenario deliberately gives the external a LOWER arrangement-id
# than the built-in, to prove the DID lookup is real and not just numeric luck.

set -uo pipefail

CFG=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail=0
ORIG_PATH=$PATH

# scenario <name> <osascript screen lines> <displays JSON> <profile> \
#          <bar display> <nsscreen idx> <front w> <title w/chars> <audio w/chars> <agents w>
scenario() {
  local name=$1 screens=$2 displays_json=$3 profile=$4 bar_display=$5 nsidx=$6
  local dir="$TMP/$1"
  mkdir -p "$dir/bin" "$dir/cache"

  printf '#!/opt/homebrew/bin/bash\nprintf "%%s\\n" %s\n' "$screens" >"$dir/bin/osascript"
  chmod +x "$dir/bin/osascript"

  cat >"$dir/bin/sketchybar" <<EOF
#!/opt/homebrew/bin/bash
printf '%s\n' "\$*" >>"\$MOCK_LOG"
if [[ "\$1" == "--query" && "\$2" == "displays" ]]; then
  printf '%s\n' '$displays_json'
fi
EOF
  chmod +x "$dir/bin/sketchybar"

  export MOCK_LOG="$dir/calls.log"; : >"$MOCK_LOG"
  export PATH="$dir/bin:$ORIG_PATH" XDG_CACHE_HOME="$dir/cache" CONFIG_DIR="$CFG"
  /opt/homebrew/bin/bash "$CFG/sketchybarrc" >/dev/null 2>"$dir/stderr.log"
  local rc=$?
  local cache="$dir/cache/sketchybar/profile"

  check() {  # <description> <condition-exit-status>
    if [[ $2 -eq 0 ]]; then echo "ok   $name: $1"; else echo "FAIL $name: $1"; fail=1; fi
  }
  has() { grep -q -- "$1" "$MOCK_LOG"; }

  check "rc exits 0"                                    "$rc"
  check "no stderr"                                     "$([[ ! -s "$dir/stderr.log" ]]; echo $?)"
  check "profile cache: PROFILE=$profile"                "$(grep -qx "PROFILE=$profile" "$cache"; echo $?)"
  check "profile cache: BAR_DISPLAY=$bar_display"        "$(grep -qx "BAR_DISPLAY=$bar_display" "$cache"; echo $?)"
  check "profile cache: MAIN_NSSCREEN_IDX=$nsidx"        "$(grep -qx "MAIN_NSSCREEN_IDX=$nsidx" "$cache"; echo $?)"
  check "bar is display=$bar_display"                    "$(has "^--bar display=$bar_display "; echo $?)"
  check "no item sets display="                          "$(grep -v '^--bar' "$MOCK_LOG" | grep -q -- ' display='; [[ $? -ne 0 ]]; echo $?)"
  # KNOWN: ICON_CHEVRON has been "" since the first commit, so the chevron item
  # has never drawn anything (see docs/plans/2026-09-23-sketchybar-followups.md).
  # Tolerate exactly that one so any NEW empty value still fails.
  check "no empty property values (bar chevron aside)"   "$(grep -v -- '--set chevron icon= ' "$MOCK_LOG" | grep -E -q -- ' [a-z_.]+=( |$)'; [[ $? -ne 0 ]]; echo $?)"
  check "display_watch subscribed to display_change"     "$(has 'display_watch display_change system_woke'; echo $?)"

  local front title audio agents
  if [[ "$profile" == wide ]]; then front=140 title=380/60 audio=200/32 agents=420
  else                              front=80  title=150/24 audio=110/16 agents=210
  fi
  check "front_app width=$front"                         "$(has "front_app.*width=$front "; echo $?)"
  check "window_title width=${title%/*} chars=${title#*/}" "$(has "window_title.*label.max_chars=${title#*/} .*label.width=${title%/*} "; echo $?)"
  check "audio_source width=${audio%/*} chars=${audio#*/}" "$(has "audio_source.*label.width=${audio%/*} .*label.max_chars=${audio#*/} "; echo $?)"
  check "agents label.width=$agents"                     "$(has "agents.*label.width=$agents "; echo $?)"
}

# Docked, external wider than the built-in. Arrangement-ids match NSScreen
# index here — the "reversed" scenario below checks the mapping is real.
scenario docked_wide \
  "'1 1 1512 32 1' '2 2 2560 0 0'" \
  '[{"DirectDisplayID":1,"arrangement-id":1},{"DirectDisplayID":2,"arrangement-id":2}]' \
  wide 2 2

# Docked, but the external's arrangement-id (1) is LOWER than the built-in's
# (2) and its DirectDisplayID (7) doesn't numerically match anything else —
# if BAR_DISPLAY still comes out 1 (not 2, not equal to the built-in's
# DID/idx), the DID→arrangement-id lookup is doing real work, not coasting
# on the common case where everything happens to line up.
scenario docked_reversed_arrangement \
  "'5 1 1512 32 1' '7 2 1920 0 0'" \
  '[{"DirectDisplayID":7,"arrangement-id":1},{"DirectDisplayID":5,"arrangement-id":2}]' \
  compact 1 2

# Undocked: only the built-in. Falls back to it, notch and all.
scenario undocked \
  "'1 1 1512 32 1'" \
  '[{"DirectDisplayID":1,"arrangement-id":1}]' \
  compact 1 1

# The rc backgrounds a delayed balance_pills.sh (startup) per scenario; let
# the last one finish so it doesn't touch a cleaned-up temp dir.
sleep 4
exit "$fail"
