#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

if [ "$SENDER" = "volume_change" ]; then
  VOLUME="$INFO"

  if [ "$VOLUME" -eq 0 ]; then
    ICON=$ICON_VOLUME_MUTE
  elif [ "$VOLUME" -lt 30 ]; then
    ICON=$ICON_VOLUME_LOW
  elif [ "$VOLUME" -lt 60 ]; then
    ICON=$ICON_VOLUME_MED
  else
    ICON=$ICON_VOLUME_HIGH
  fi

  sketchybar --set $NAME icon="$ICON" label="${VOLUME}%"
fi
