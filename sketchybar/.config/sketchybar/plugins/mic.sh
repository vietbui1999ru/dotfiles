#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

MIC_VOLUME=$(osascript -e 'input volume of (get volume settings)')

# Inputs without software gain report "missing value".
if ! [[ "$MIC_VOLUME" =~ ^[0-9]+$ ]]; then
  ICON=$ICON_MIC
  COLOR=$ICON_COLOR
  LABEL="--"
elif [ "$MIC_VOLUME" -eq 0 ]; then
  ICON=$ICON_MIC_MUTE
  COLOR=$MIC_MUTE_COLOR
  LABEL="muted"
else
  ICON=$ICON_MIC
  COLOR=$ICON_COLOR
  LABEL="${MIC_VOLUME}%"
fi

sketchybar --set $NAME icon="$ICON" icon.color="$COLOR" label="$LABEL"
