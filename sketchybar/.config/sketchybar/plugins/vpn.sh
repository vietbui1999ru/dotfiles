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

is_connected "io.tailscale" && tailscale=on || tailscale=off
is_connected "protonvpn" && proton=on || proton=off

if [[ "$tailscale" == on ]]; then
  sketchybar --set vpn.tailscale icon="$ICON_TAILSCALE_ON" icon.color="$VPN_ON_COLOR"
else
  sketchybar --set vpn.tailscale icon="$ICON_TAILSCALE_OFF" icon.color="$VPN_OFF_COLOR"
fi

if [[ "$proton" == on ]]; then
  sketchybar --set vpn.protonvpn icon="$ICON_PROTONVPN_ON" icon.color="$VPN_ON_COLOR"
else
  sketchybar --set vpn.protonvpn icon="$ICON_PROTONVPN_OFF" icon.color="$VPN_OFF_COLOR"
fi

# Icon-only glyphs are fixed width, so connection state alone never changes
# right_pill's raw width — but balance_pills.sh zeros both spacers before
# every remeasure, so calling it unconditionally on this 30s poll flickered
# the pill by the correction amount every 30s even with nothing to fix.
# Only rebalance when a connection actually flipped.
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/sketchybar/vpn.state"
NEW="tailscale=$tailscale proton=$proton"
OLD=$(cat "$CACHE" 2>/dev/null)
if [[ "$NEW" != "$OLD" ]]; then
  printf '%s' "$NEW" > "$CACHE"
  CALLER=vpn "$CONFIG_DIR/plugins/balance_pills.sh"
fi
