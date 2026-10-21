#!/opt/homebrew/bin/bash
# Right pill, rightmost: agent status pushed by scripts/herdr-sketchybar-bridge
# through the agent_state event. Reads left to right as
#   <robot>  ! <blocked>  ∑ <total>  <hammer> <pi>  » <NEXT gist>
# Each count is its own item so it can take herdr's status color (colors.sh).
# Added right to left: first added is rightmost. Only `agents` runs the
# plugin; it sets the siblings.

sketchybar --add item agents.next right \
           --set agents.next \
                 drawing=off \
                 icon=$ICON_NEXT \
                 icon.color=$MUTED_TEAL \
                 icon.font="Hack Nerd Font Mono:Regular:13.0" \
                 label.font="Hack Nerd Font Mono:Regular:13.0" \
                 label.max_chars=$NEXT_CHARS \
                 label.width=$NEXT_W \
                 label.scroll_duration=$NEXT_SCROLL \
                 scroll_texts=on

sketchybar --add item agents.pi right \
           --set agents.pi \
                 drawing=off \
                 icon=$ICON_PI \
                 icon.color=$HERDR_WORKING \
                 label.color=$HERDR_WORKING \
                 label.font="Hack Nerd Font Mono:Regular:13.0"

for kind in total blocked; do
  sketchybar --add item "agents.$kind" right \
             --set "agents.$kind" \
                   icon.font="Hack Nerd Font Mono:Bold:13.0" \
                   icon.color=$MUTED_TEAL \
                   label.color=$MUTED_TEAL \
                   label.font="Hack Nerd Font Mono:Regular:13.0"
done
sketchybar --set agents.blocked icon="!" --set agents.total icon="∑"

sketchybar --add item agents right \
           --set agents \
                 icon=$ICON_CLAUDE \
                 label.drawing=off \
                 click_script="$PLUGIN_DIR/agents.sh" \
                 script="$PLUGIN_DIR/agents.sh" \
           --subscribe agents agent_state

add_sep sep.agents
