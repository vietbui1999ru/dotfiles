#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

CPU_LINE=$(top -l 1 -n 0 2>/dev/null | grep "CPU usage")
IDLE=$(echo "$CPU_LINE" | sed 's/.*,[[:space:]]*\([0-9.]*\)% idle.*/\1/')
USAGE=$(printf "%.0f" "$(echo "100 - ${IDLE:-100}" | bc)")
USAGE_FRAC=$(echo "scale=2; ${USAGE:-0} / 100" | bc)

if [ "${USAGE:-0}" -gt 80 ] 2>/dev/null; then
    COLOR=$BATTERY_WARNING_COLOR
else
    COLOR=$SAGE
fi

sketchybar --push "$NAME" "$USAGE_FRAC" \
           --set "$NAME" \
                 icon.color="$COLOR" \
                 graph.color="$COLOR" \
                 label="${USAGE}%"
