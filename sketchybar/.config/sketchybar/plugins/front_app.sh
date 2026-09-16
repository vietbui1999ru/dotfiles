#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"

if [ "$SENDER" = "front_app_switched" ]; then
  sketchybar --set "$NAME" label="$INFO"
  # front_app is a fixed width=80 item — app-name text never changes
  # left_pill's raw content width — but log the trigger anyway so an
  # app switch shows up in the same trail as every other left_pill event.
  CALLER=front_app "$CONFIG_DIR/plugins/balance_pills.sh"
fi
