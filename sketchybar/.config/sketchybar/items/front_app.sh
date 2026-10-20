#!/opt/homebrew/bin/bash
# Left pill, after the workspaces: front app name, window title, the app
# currently playing audio, and the balance spacer. All fixed-width except
# audio_source, which toggles drawing (and so rebalances the pills).

# padding_left=13 keeps the gap the old (always-empty) chevron item left.
sketchybar --add item front_app left \
           --set front_app \
                 icon.drawing=off \
                 label.font="SF Pro:Bold:13.0" \
                 label.color=$APP_NAME_COLOR \
                 padding_left=13 \
                 width=$FRONT_APP_W \
                 script="$PLUGIN_DIR/front_app.sh" \
           --subscribe front_app front_app_switched

sketchybar --add item window_title left \
           --set window_title \
                 icon.drawing=off \
                 label.font="SF Pro:Regular:12.0" \
                 label.color=$WINDOW_TITLE_COLOR \
                 label.max_chars=$TITLE_CHARS \
                 label.width=$TITLE_W \
                 scroll_texts=on \
                 width=$TITLE_W \
                 script="$PLUGIN_DIR/front_app.sh" \
           --subscribe window_title front_app_switched

# Which app is currently the system's audio source (browser tab playing
# video, Music, Spotify, ...) — app name only, no track metadata.
# label.width caps it so it can't push left_pill wider than right_pill;
# scroll_texts wraps the text within that width instead of spilling.
sketchybar --add item audio_source left \
           --set audio_source \
                 icon=$ICON_AUDIO_SOURCE \
                 icon.color=$AUDIO_SOURCE_ICON_COLOR \
                 label.color=$AUDIO_SOURCE_LABEL_COLOR \
                 label.font="SF Pro:Regular:12.0" \
                 label.width=$AUDIO_W \
                 label.max_chars=$AUDIO_CHARS \
                 scroll_texts=on \
                 drawing=off \
                 update_freq=5 \
                 script="$PLUGIN_DIR/audio_source.sh"

# Padded by balance_pills.sh so both pills come out the same width.
sketchybar --add item left_spacer left \
           --set left_spacer \
                 label.drawing=off \
                 icon.drawing=off \
                 background.drawing=off \
                 padding_right=5 \
                 width=0
