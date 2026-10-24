#!/opt/homebrew/bin/bash
# Right pill, left of VPN: claude-tui usage as a gauge icon colored by the
# worst live quota. Click or alt-u (aerospace) toggles a popup with one row
# per subscription. The popup hangs off claude_usage.popup, a zero-width
# center item, so it is centered on the screen rather than pinned to the
# gauge (sketchybar has no popup x offset; align is relative to the owner).
# plugins/claude_usage.sh refreshes icon and rows every 60s and on click,
# so an opened popup is never older than one tick.

add_sep sep.claude_usage

sketchybar --add item claude_usage right \
           --set claude_usage \
                 icon=$ICON_USAGE \
                 icon.color=$MUTED_TEAL \
                 label.drawing=off \
                 update_freq=60 \
                 script="$PLUGIN_DIR/claude_usage.sh" \
                 click_script="$PLUGIN_DIR/claude_usage.sh"

sketchybar --add item claude_usage.popup center \
           --set claude_usage.popup \
                 width=0 \
                 icon.drawing=off \
                 label.drawing=off \
                 background.drawing=off \
                 popup.align=center \
                 popup.background.color=$ISLAND_BG \
                 popup.background.corner_radius=11 \
                 popup.background.drawing=on

for row in claude chatgpt opencode; do
  sketchybar --add item "claude_usage.$row" popup.claude_usage.popup \
             --set "claude_usage.$row" \
                   icon.drawing=off \
                   label.font="Hack Nerd Font Mono:Regular:13.0" \
                   label.padding_left=10 \
                   label.padding_right=10
done
