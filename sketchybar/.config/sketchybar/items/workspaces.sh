#!/opt/homebrew/bin/bash
# Left pill: one item per AeroSpace workspace, in bar order. Sourced by
# sketchybarrc; ORDERED_WORKSPACES is reused by items/brackets.sh.

ORDERED_WORKSPACES=("1" "2" "3" "4" "0" "B" "T" "P" "C" "O" "N" "M" "S" "R")

for sid in "${ORDERED_WORKSPACES[@]}"; do
  icon="${WORKSPACE_ICONS[$sid]:-$sid}"
  sketchybar --add item space.$sid left \
    --subscribe space.$sid aerospace_workspace_change display_change system_woke mouse.entered mouse.exited \
    --set space.$sid \
      icon="$icon" \
      icon.font="Hack Nerd Font Mono:Bold:16.0" \
      icon.padding_left=5 \
      icon.padding_right=4 \
      label.font="sketchybar-app-font:Regular:16.0" \
      label.padding_right=5 \
      label.drawing=on \
      label.y_offset=1 \
      background.corner_radius=25 \
      background.height=26 \
      padding_right=0 \
      click_script="aerospace workspace $sid" \
      script="$PLUGIN_DIR/aerospace.sh $sid"
done
sketchybar --set space.1 padding_left=5
