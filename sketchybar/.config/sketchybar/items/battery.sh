#!/opt/homebrew/bin/bash
# Right pill, between mic and VPN. Fixed right-aligned label.width so a
# change from "9%" to "100%" never resizes the pill.

add_sep sep.battery

sketchybar --add item battery right \
           --set battery \
                 label.width=36 \
                 label.align=right \
                 update_freq=120 \
                 script="$PLUGIN_DIR/battery.sh" \
           --subscribe battery power_source_change system_woke
