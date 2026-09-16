#!/bin/bash
# Drives vpn.tailscale and vpn.protonvpn (icon-only, no names — see git log
# for why: raw scutil service names ate too much pill width).

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

NC_LIST=$(scutil --nc list 2>/dev/null)

# Each scutil line is one VPN service; match by bundle id, not display
# name, since the user can rename a service in System Settings.
is_connected() {
  echo "$NC_LIST" | grep -i "$1" | grep -q "(Connected)"
}

if is_connected "io.tailscale"; then
  sketchybar --set vpn.tailscale icon="$ICON_TAILSCALE_ON" icon.color="$VPN_ON_COLOR"
else
  sketchybar --set vpn.tailscale icon="$ICON_TAILSCALE_OFF" icon.color="$VPN_OFF_COLOR"
fi

if is_connected "protonvpn"; then
  sketchybar --set vpn.protonvpn icon="$ICON_PROTONVPN_ON" icon.color="$VPN_ON_COLOR"
else
  sketchybar --set vpn.protonvpn icon="$ICON_PROTONVPN_OFF" icon.color="$VPN_OFF_COLOR"
fi

# Icon-only glyphs are fixed width, so this no longer changes right_pill's
# width — call kept for safety/consistency with the other pollers; cheap.
"$CONFIG_DIR/plugins/balance_pills.sh"
