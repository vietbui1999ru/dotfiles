#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

MIC_VOLUME=$(osascript -e 'input volume of (get volume settings)')

if [ "$MIC_VOLUME" -eq 0 ]; then
  osascript -e 'set volume input volume 25'
  sketchybar --set $NAME icon="$ICON_MIC" icon.color="$ICON_COLOR" label="25%"
else
  osascript -e 'set volume input volume 0'
  sketchybar --set $NAME icon="$ICON_MIC_MUTE" icon.color="$MIC_MUTE_COLOR" label="muted"
fi
