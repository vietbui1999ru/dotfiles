#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"
VPN=$(scutil --nc list | grep Connected | sed -E 's/.*"(.*)".*/\1/')

if [[ $VPN != "" ]]; then
  sketchybar -m --set vpn icon="$ICON_VPN_OFF" \
                          label="$VPN" \
                          drawing=on
else
  sketchybar -m --set vpn icon="$ICON_VPN" \
                          label="Off" \
                          drawing=on
fi

# Label width varies with number of connected VPNs — rebalance.
"$CONFIG_DIR/plugins/balance_pills.sh"
