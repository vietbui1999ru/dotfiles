#!/opt/homebrew/bin/bash
# Invisible, in neither pill. display_change fires on hot-plug and
# resolution change (and on focus moving between displays); the script only
# reloads if the target display's profile actually changed.

sketchybar --add item display_watch left \
           --set display_watch \
                 drawing=off \
                 script="$PLUGIN_DIR/display_profile.sh" \
           --subscribe display_watch display_change system_woke
