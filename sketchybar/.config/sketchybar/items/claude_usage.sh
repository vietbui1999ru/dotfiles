#!/opt/homebrew/bin/bash
# Right pill, left of VPN: Claude usage from `claude-tui status --line`
# (refreshed by plugins/claude_usage.sh every 60s). Fixed label.width from
# profile.sh with scroll_texts, so a long line scrolls instead of resizing.

add_sep sep.claude_usage

sketchybar --add item claude_usage right \
           --set claude_usage \
                 icon.drawing=off \
                 label.max_chars=80 \
                 label.width=$CLAUDE_USAGE_W \
                 scroll_texts=on \
                 label.font="Hack Nerd Font Mono:Regular:13.0" \
                 update_freq=60 \
                 script="$PLUGIN_DIR/claude_usage.sh"
