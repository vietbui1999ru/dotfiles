#!/opt/homebrew/bin/bash
# The two pills. Sourced last among the visible items: a bracket can only
# group items that already exist. right_spacer is the right pill's
# leftmost member, padded by balance_pills.sh like left_spacer.

sketchybar --add item right_spacer right \
           --set right_spacer \
                 label.drawing=off \
                 icon.drawing=off \
                 background.drawing=off \
                 padding_left=5 \
                 width=0

sketchybar --add bracket left_pill \
             "${ORDERED_WORKSPACES[@]/#/space.}" \
             front_app window_title audio_source left_spacer \
           --set left_pill \
             background.color=$ISLAND_BG \
             background.corner_radius=25 \
             background.height=37 \
             background.padding_left=7 \
             background.drawing=on

sketchybar --add bracket right_pill \
             right_spacer \
             vpn.tailscale vpn.protonvpn sep.vpn \
             battery sep.battery \
             mic sep.mic \
             calendar sep.cal \
             clock sep.agents agents \
           --set right_pill \
             background.color=$ISLAND_BG \
             background.corner_radius=25 \
             background.height=37 \
             background.padding_right=7 \
             background.drawing=on
