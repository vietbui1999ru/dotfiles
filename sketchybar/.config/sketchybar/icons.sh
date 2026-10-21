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
export ICON_BATTERY_100="󰽢"
export ICON_BATTERY_75="󰽦"
export ICON_BATTERY_50="󰽣"
export ICON_BATTERY_25="󰽥"
export ICON_BATTERY_0="󰽤"
export ICON_BATTERY_CHARGING="󱐌"
export ICON_AUDIO_SOURCE="󰕾"
export ICON_TAILSCALE_ON="󰒍"
export ICON_TAILSCALE_OFF="󰒎"
export ICON_PROTONVPN_ON="󰕥"
export ICON_PROTONVPN_OFF="󰦞"
export ICON_MIC="󰍬"
export ICON_MIC_MUTE="󰍭"
export ICON_CLAUDE=$'\U000F16A1'   # md-robot (also the C workspace icon)
export ICON_PI=$'\U000F08EA'       # md-hammer
export ICON_NEXT=$''         # fa-angles-right
export ICON_USAGE=$'\U000F029A'    # md-gauge

export ICON_SEPARATOR="│"
