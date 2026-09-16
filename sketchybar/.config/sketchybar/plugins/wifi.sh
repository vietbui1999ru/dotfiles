#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

# Check if wifi interface is active and has an IP
IP=$(ipconfig getifaddr en0 2>/dev/null)

if [ -n "$IP" ]; then
  sketchybar --set $NAME icon=$ICON_WIFI label="On"
else
  sketchybar --set $NAME icon=$ICON_WIFI_OFF label="Off"
fi
