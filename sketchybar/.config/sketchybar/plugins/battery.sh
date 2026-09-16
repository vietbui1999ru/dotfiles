#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

PERCENTAGE=$(pmset -g batt | grep -Eo "\d+%" | head -1 | tr -d '%')
CHARGING=$(pmset -g batt | grep -c "AC Power")

if [ "$CHARGING" -gt 0 ]; then
  ICON=$ICON_BATTERY_CHARGING
  COLOR=$BATTERY_NORMAL_COLOR
elif [ "$PERCENTAGE" -gt 75 ]; then
  ICON=$ICON_BATTERY_100
  COLOR=$BATTERY_NORMAL_COLOR
elif [ "$PERCENTAGE" -gt 50 ]; then
  ICON=$ICON_BATTERY_75
  COLOR=$BATTERY_NORMAL_COLOR
elif [ "$PERCENTAGE" -gt 25 ]; then
  ICON=$ICON_BATTERY_50
  COLOR=$BATTERY_NORMAL_COLOR
elif [ "$PERCENTAGE" -gt 10 ]; then
  ICON=$ICON_BATTERY_25
  COLOR=$BATTERY_WARNING_COLOR
else
  ICON=$ICON_BATTERY_0
  COLOR=$BATTERY_WARNING_COLOR
fi

sketchybar --set $NAME icon="$ICON" icon.color=$COLOR label="${PERCENTAGE}%"
