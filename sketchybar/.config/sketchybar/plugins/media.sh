#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

STATE=$(nowplaying-cli get playbackRate 2>/dev/null)
TITLE=$(nowplaying-cli get title 2>/dev/null)
ARTIST=$(nowplaying-cli get artist 2>/dev/null)

# Check if anything is playing (playbackRate > 0 or title exists)
if [ -n "$TITLE" ] && [ "$TITLE" != "null" ] && [ "$STATE" != "0" ]; then
  if [ -n "$ARTIST" ] && [ "$ARTIST" != "null" ]; then
    DISPLAY="$ARTIST — $TITLE"
  else
    DISPLAY="$TITLE"
  fi
  sketchybar --set $NAME drawing=on label="$DISPLAY" \
             --set separator_media drawing=on
else
  sketchybar --set $NAME drawing=off \
             --set separator_media drawing=off
fi
