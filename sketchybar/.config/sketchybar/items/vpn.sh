#!/opt/homebrew/bin/bash
# Right pill: Tailscale and ProtonVPN connection icons (icon-only, fixed width).

add_sep sep.vpn

sketchybar --add item vpn.tailscale right \
           --set vpn.tailscale \
                 icon=$ICON_TAILSCALE_OFF \
                 label.drawing=off \
                 padding_left=5 \
                 padding_right=2 \
                 update_freq=30 \
                 script="$PLUGIN_DIR/vpn.sh"

# No script/update_freq here — vpn.tailscale's poll sets both items.
sketchybar --add item vpn.protonvpn right \
           --set vpn.protonvpn \
                 icon=$ICON_PROTONVPN_OFF \
                 label.drawing=off \
                 padding_left=2
