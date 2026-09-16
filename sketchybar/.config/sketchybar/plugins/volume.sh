#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

if [ "$SENDER" = "volume_change" ]; then
  VOLUME="$INFO"

  # Outputs without software volume (HDMI, some USB DACs) send a non-number.
  if ! [[ "$VOLUME" =~ ^[0-9]+$ ]]; then
    sketchybar --set $NAME icon="$ICON_VOLUME_HIGH" label="--"
    exit 0
  fi

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
