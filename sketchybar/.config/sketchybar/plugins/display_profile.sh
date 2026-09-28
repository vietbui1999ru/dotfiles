#!/opt/homebrew/bin/bash
# Keeps the bar pinned to the external display and its layout profile in sync.
#
#   display_profile.sh detect   write the profile cache (sketchybarrc, at load)
#   display_profile.sh          event mode (display_change / system_woke):
#                               re-measure, and --reload only if it changed
#
# By design this ignores macOS's own "main display" setting (System Settings >
# Displays > Arrangement > menu bar). Verified live 2026-09-28 docked with the
# lid open: macOS still reported the built-in as main, so display=main alone
# would have put the bar on the laptop panel. Instead: identify the built-in
# panel via CGDisplayIsBuiltin and always prefer whichever OTHER display is
# attached. Undocked (only the built-in present), that's the only choice.
#
# sketchybar fires display_change on hot-plug, resolution change, and when
# focus moves between displays. Only the first two change the fingerprint, so
# moving the mouse to another screen re-measures but never reloads.

CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/profile"
WIDE_MIN_W=2200   # points; the laptop panel is ~1800, a wide external >=2560

# One line per NSScreen: "<CGDirectDisplayID> <NSScreen 1-based index> <width> <notch inset> <isBuiltin 0|1>"
enumerate_screens() {
  osascript -l JavaScript -e '
    ObjC.import("CoreGraphics");
    ObjC.import("AppKit");
    ObjC.bindFunction("CGDisplayIsBuiltin", ["I", ["I"]]);
    var screens = $.NSScreen.screens;
    var lines = [];
    for (var i = 0; i < screens.count; i++) {
      var s = screens.objectAtIndex(i);
      var did = s.deviceDescription.objectForKey("NSScreenNumber").unsignedIntValue;
      lines.push(did + " " + (i + 1) + " " + s.frame.size.width + " "
                 + s.safeAreaInsets.top + " " + $.CGDisplayIsBuiltin(did));
    }
    lines.join("\n")
  ' 2>/dev/null
}

# sketchybar's --bar display= takes an arrangement-id (its own 1-based index
# into WindowServer's display list), a third numbering distinct from both
# CGDirectDisplayID and AeroSpace's NSScreen index. Maps a DirectDisplayID to
# its current arrangement-id.
arrangement_id_for() {
  sketchybar --query displays 2>/dev/null | /usr/bin/python3 -c "
import sys, json
try:
  for d in json.load(sys.stdin):
    if d['DirectDisplayID'] == $1:
      print(d['arrangement-id']); break
except Exception:
  pass
"
}

# Prints the cache body, or fails if any step can't be read.
measure() {
  local screens line target_did target_idx target_w target_notch arrangement
  screens=$(enumerate_screens) || return 1
  [[ -n "$screens" ]] || return 1

  # Prefer an external (isBuiltin=0); among several, the widest. Falls back
  # to the lone built-in when nothing else is attached.
  line=$(printf '%s\n' "$screens" | awk '$5==0' | sort -k3 -n -r | head -1)
  [[ -z "$line" ]] && line=$(printf '%s\n' "$screens" | awk '$5==1' | head -1)
  [[ -z "$line" ]] && return 1
  read -r target_did target_idx target_w target_notch _ <<<"$line"
  [[ "$target_did" =~ ^[0-9]+$ && "$target_w" =~ ^[0-9]+(\.[0-9]+)?$ ]] || return 1
  target_w=${target_w%.*}; target_notch=${target_notch%.*}

  arrangement=$(arrangement_id_for "$target_did")
  [[ "$arrangement" =~ ^[0-9]+$ ]] || arrangement=main   # sketchybar accepts "main" too

  local profile=compact
  (( target_w >= WIDE_MIN_W )) && profile=wide
  printf 'PROFILE=%s\nSCREEN_W=%s\nHAS_NOTCH=%s\nBAR_DISPLAY=%s\nMAIN_NSSCREEN_IDX=%s\n' \
    "$profile" "$target_w" "$(( target_notch > 0 ? 1 : 0 ))" "$arrangement" "$target_idx"
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
