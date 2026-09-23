#!/opt/homebrew/bin/bash
# Keeps the bar's layout profile in sync with the MAIN display.
#
#   display_profile.sh detect   write the profile cache (sketchybarrc, at load)
#   display_profile.sh          event mode (display_change / system_woke):
#                               re-measure, and --reload only if it changed
#
# sketchybar fires display_change on hot-plug, resolution change, and when
# focus moves between displays. Only the first two change the fingerprint, so
# moving the mouse to another screen re-measures but never reloads.

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/profile"
WIDE_MIN_W=2200   # points; the laptop panel is ~1800, the 27" external 2560

# Prints the cache body for the main display, or fails if it can't be read.
# NSScreen.screens[0] is the screen with the menu bar, i.e. the same one
# sketchybar's `display=main` and aerospace's nsscreen id 1 refer to.
measure() {
  local out w inset
  out=$(osascript -l JavaScript -e '
    ObjC.import("AppKit");
    var s = $.NSScreen.screens.objectAtIndex(0);
    s.frame.size.width + " " + s.safeAreaInsets.top' 2>/dev/null) || return 1
  read -r w inset <<<"$out"
  w=${w%.*}; inset=${inset%.*}
  [[ "$w" =~ ^[0-9]+$ && "$inset" =~ ^[0-9]+$ ]] || return 1

  local profile=compact
  (( w >= WIDE_MIN_W )) && profile=wide
  printf 'PROFILE=%s\nSCREEN_W=%s\nHAS_NOTCH=%s\n' \
    "$profile" "$w" "$(( inset > 0 ? 1 : 0 ))"
}

mkdir -p "$(dirname "$CACHE")"

if [[ "$1" == "detect" ]]; then
  new=$(measure) && printf '%s\n' "$new" > "$CACHE"
  exit 0
fi

# Hot-plug fires a burst of events while macOS reconfigures; let it settle.
sleep 1
new=$(measure) || exit 0
old=$(cat "$CACHE" 2>/dev/null)
[[ "$new" == "$old" ]] && exit 0

printf '%s\n' "$new" > "$CACHE"
sketchybar --reload
