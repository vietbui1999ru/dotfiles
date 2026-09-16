#!/opt/homebrew/bin/bash
# Shows which app currently owns the system's audio session (browser tab,
# Music, Spotify, ...) — app name only, never track metadata.
# Coverage note: only apps that register a Now Playing session appear here.
# Zoom/Discord/FaceTime calls don't, so they never show — macOS has no
# public API for "which app is writing to CoreAudio output" to fall back to.

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

# Bundle id -> display name for common Now-Playing-capable apps. Unknown
# bundle ids fall back to their last dot-component, capitalized.
declare -A APP_NAMES=(
  [com.apple.Safari]="Safari"
  [com.google.Chrome]="Chrome"
  [org.mozilla.firefox]="Firefox"
  [company.thebrowser.Browser]="Arc"
  [com.brave.Browser]="Brave"
  [com.microsoft.edgemac]="Edge"
  [com.apple.Music]="Music"
  [com.spotify.client]="Spotify"
  [com.apple.QuickTimePlayerX]="QuickTime"
)

CACHE="${TMPDIR:-/tmp}/sketchybar_audio_source"

RAW=$(nowplaying-cli get-raw 2>/dev/null)

# Single python parse: pulls bundle id + whether playback is actually
# active (title present and rate != 0) out of the raw plist JSON.
read -r BUNDLE SHOW <<<"$(printf '%s' "$RAW" | /usr/bin/python3 -c '
import sys, json
try:
    d = json.load(sys.stdin)
    bundle = d.get("kMRMediaRemoteNowPlayingInfoClientBundleIdentifier", "")
    title = d.get("kMRMediaRemoteNowPlayingInfoTitle", "")
    rate = d.get("kMRMediaRemoteNowPlayingInfoPlaybackRate", 0)
    show = "1" if title and rate else "0"
    print(bundle or "-", show)
except Exception:
    print("-", "0")
')"

if [[ "$SHOW" == "1" ]]; then
  FALLBACK="${BUNDLE##*.}"
  APP_LABEL="${APP_NAMES[$BUNDLE]:-${FALLBACK^}}"
  NEW="on|$APP_LABEL"
else
  NEW="off|"
fi

OLD=$(cat "$CACHE" 2>/dev/null)
[[ "$NEW" == "$OLD" ]] && exit 0
printf '%s' "$NEW" > "$CACHE"

# Item stays drawing=on always — only the icon color and label text change.
# Toggling drawing=off/on used to add/remove this item's whole box
# (~110-130px) from left_pill's raw content width every time playback
# started or stopped, which is the same "real content-width change"
# class of bug as the unbounded labels fixed earlier, just via presence
# instead of text length. Dimming the icon instead means the reserved
# label.width box never disappears, so left_pill's width never moves.
if [[ "$NEW" == on* ]]; then
  sketchybar --set "$NAME" icon.color="$AUDIO_SOURCE_ICON_COLOR" label="${NEW#on|}"
else
  sketchybar --set "$NAME" icon.color="$AUDIO_SOURCE_IDLE_COLOR" label=""
fi
