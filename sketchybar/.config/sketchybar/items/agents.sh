#!/opt/homebrew/bin/bash
# Right pill, rightmost: agent status pushed by scripts/herdr-sketchybar-bridge
# through the agent_state event. Fixed label.width (from profile.sh) plus
# scroll_texts, so a long NEXT step scrolls instead of resizing the pill.

sketchybar --add item agents right \
           --set agents \
                 icon.drawing=off \
                 label.max_chars=300 \
                 label.width=$AGENTS_W \
                 label.font="Hack Nerd Font Mono:Regular:13.0" \
                 scroll_texts=on \
                 click_script="$PLUGIN_DIR/agents.sh" \
                 script="$PLUGIN_DIR/agents.sh" \
           --subscribe agents agent_state

add_sep sep.agents
