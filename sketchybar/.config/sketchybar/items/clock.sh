#!/opt/homebrew/bin/bash
# Right pill: time and date.

sketchybar --add item clock right \
           --set clock \
                 icon=$ICON_CLOCK \
                 padding_right=5 \
                 update_freq=60 \
                 script="$PLUGIN_DIR/clock.sh"

add_sep sep.cal

sketchybar --add item calendar right \
           --set calendar \
                 padding_right=-1 \
                 icon=$ICON_CALENDAR \
                 update_freq=3600 \
                 script="$PLUGIN_DIR/calendar.sh"
