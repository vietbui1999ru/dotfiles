#!/opt/homebrew/bin/bash

# Workspace icons (Nerd Font)
declare -A WORKSPACE_ICONS
WORKSPACE_ICONS=(
  [B]=""       # Browser
  [T]=""       # Terminal
  [M]="󰦚"      # Music
  [N]="󰍩"      # Notifications/Slack/Discord
  [O]="󰏪"      # Notes/Obsidian
  [P]=""       # Programming
  [S]=""       # Services
  [C]="󱚡"      # Chat robot ai
  [R]="󰗚"       # Reading
  [0]="󰼎"
  [1]="󰼏"
  [2]="󰼐"
  [3]="󰼑"
)

# System icons
export ICON_CLOCK="󰺗"
export ICON_CALENDAR="󰨲"
export ICON_WIFI="󰤨"
export ICON_WIFI_OFF="󰤭"
export ICON_VOLUME_HIGH="󰕾"
export ICON_VOLUME_MED="󰖀"
export ICON_VOLUME_LOW="󰕿"
export ICON_VOLUME_MUTE="󰝟"
export ICON_BATTERY_100="󰽢"
export ICON_BATTERY_75="󰽦"
export ICON_BATTERY_50="󰽣"
export ICON_BATTERY_25="󰽥"
export ICON_BATTERY_0="󰽤"
export ICON_BATTERY_CHARGING="󱐌"
# export ICON_BRIGHTNESS="󰃟"
export ICON_AUDIO_SOURCE="󰕾"
export ICON_VPN="󰹻"
export ICON_VPN_OFF=""
export ICON_TAILSCALE_ON="󰒍"
export ICON_TAILSCALE_OFF="󰒎"
export ICON_PROTONVPN_ON="󰕥"
export ICON_PROTONVPN_OFF="󰦞"
export ICON_MIC="󰍬"
export ICON_MIC_MUTE="󰍭"
export ICON_TIMER="󰄉"
export ICON_CPU="󰍛"
export ICON_CLAUDE="󱚡"

# App icon (chevron separator after workspaces)
export ICON_CHEVRON=""
export ICON_SEPARATOR="│"
