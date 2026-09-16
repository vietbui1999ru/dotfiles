#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

sketchybar --set "$NAME" label="$(date '+%a %b %d')"
