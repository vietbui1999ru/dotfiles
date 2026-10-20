#!/opt/homebrew/bin/bash
# Right pill: input volume, click to mute. Fixed label.width so the
# percentage never resizes the pill.

add_sep sep.mic

sketchybar --add item mic right \
           --set mic \
                 icon=$ICON_MIC \
                 label.width=42 \
                 label.align=right \
                 update_freq=3 \
                 script="$PLUGIN_DIR/mic.sh" \
                 click_script="$PLUGIN_DIR/mic_click.sh"
