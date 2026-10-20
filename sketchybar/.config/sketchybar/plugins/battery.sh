#!/opt/homebrew/bin/bash
# Battery percentage and level glyph; the bolt glyph while on AC power.

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

BATT=$(pmset -g batt)
PERCENTAGE=$(grep -Eo '[0-9]+%' <<<"$BATT" | head -1 | tr -d '%')
[[ -z "$PERCENTAGE" ]] && exit 0   # no battery (desktop Mac)

COLOR=$BATTERY_NORMAL_COLOR
if [[ "$BATT" == *"AC Power"* ]]; then
  ICON=$ICON_BATTERY_CHARGING
elif (( PERCENTAGE > 75 )); then
  ICON=$ICON_BATTERY_100
elif (( PERCENTAGE > 50 )); then
  ICON=$ICON_BATTERY_75
elif (( PERCENTAGE > 25 )); then
  ICON=$ICON_BATTERY_50
elif (( PERCENTAGE > 10 )); then
  ICON=$ICON_BATTERY_25
  COLOR=$BATTERY_WARNING_COLOR
else
  ICON=$ICON_BATTERY_0
  COLOR=$BATTERY_WARNING_COLOR
fi

sketchybar --set "$NAME" icon="$ICON" icon.color="$COLOR" label="${PERCENTAGE}%"
