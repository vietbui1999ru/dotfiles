#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

# Last rendered state, so the 5s poll only touches the bar on real changes.
# Re-setting an identical label restarts scroll_texts and causes flicker.
CACHE="${TMPDIR:-/tmp}/sketchybar_media_${NAME}"

clean() { [[ "$1" == "null" ]] && echo "" || echo "$1"; }

STATE=$(clean "$(nowplaying-cli get playbackRate 2>/dev/null)")
TITLE=$(clean "$(nowplaying-cli get title 2>/dev/null)")
ARTIST=$(clean "$(nowplaying-cli get artist 2>/dev/null)")

# Decide whether the pill should be visible for the current source.
# Returns 0 (show) or 1 (hide).
should_show() {
  [[ -n "$TITLE" && -n "$STATE" && "$STATE" != "0" ]]
}

if should_show; then
  LABEL="${ARTIST:+$ARTIST — }$TITLE"
  NEW="on|$LABEL"
else
  LABEL=""
  NEW="off|"
fi

OLD=$(cat "$CACHE" 2>/dev/null)
[[ "$NEW" == "$OLD" ]] && exit 0
printf '%s' "$NEW" > "$CACHE"

if [[ "$NEW" == on* ]]; then
  sketchybar --set "$NAME" drawing=on label="$LABEL" \
             --set sep.media drawing=on
else
  sketchybar --set "$NAME" drawing=off \
             --set sep.media drawing=off
fi

# Only visibility flips change right_pill's width (label.width is fixed).
if [[ "${OLD%%|*}" != "${NEW%%|*}" ]]; then
  "$CONFIG_DIR/plugins/balance_pills.sh"
fi
