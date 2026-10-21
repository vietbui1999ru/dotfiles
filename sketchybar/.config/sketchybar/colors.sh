#!/opt/homebrew/bin/bash

# ── Palette (Gruvbox Material Dark Soft, matches kitty) ──
export ICE=0xffd4be98
export DARK_TEAL=0xffd4be98
export SAGE=0xff7daea3
export MUTED_TEAL=0xff928374

# ── Bar ──────────────────────────────────────────
export BAR_COLOR=0xe032302f
export ISLAND_BG=$BAR_COLOR
export SEPARATOR_COLOR=0x30d4be98
export TRANSPARENT=0x00000000

# ── Defaults (fallback for all items) ────────────
export ICON_COLOR=$DARK_TEAL
export LABEL_COLOR=$DARK_TEAL

# ── Workspaces ───────────────────────────────────
export WORKSPACE_ACTIVE_ICON=$DARK_TEAL
export WORKSPACE_ACTIVE_BG=0x407daea3
export WORKSPACE_INACTIVE_ICON=$MUTED_TEAL


# ── Front App ────────────────────────────────────
export APP_NAME_COLOR=$DARK_TEAL
export WINDOW_TITLE_COLOR=$SAGE

# ── Audio source ─────────────────────────────────
export AUDIO_SOURCE_ICON_COLOR=$SAGE
export AUDIO_SOURCE_LABEL_COLOR=$SAGE

# ── VPN ──────────────────────────────────────────
export VPN_ON_COLOR=$SAGE
export VPN_OFF_COLOR=$MUTED_TEAL

# ── Herdr agent status ───────────────────────────
# herdr's own gruvbox status colors (src/client/shell.rs, v0.9.5), so the bar
# reads like herdr's sidebar dots. unknown is herdr's overlay0 = MUTED_TEAL.
export HERDR_BLOCKED=0xfffb4934
export HERDR_WORKING=0xfffabd2f
export HERDR_DONE=0xff8ec07c
export HERDR_IDLE=0xffb8bb26
export HERDR_UNKNOWN=$MUTED_TEAL

# ── Claude usage ─────────────────────────────────
# Quota thresholds reuse herdr's gruvbox: idle green, working yellow, blocked red.
export USAGE_OK_COLOR=$HERDR_IDLE
export USAGE_WARN_COLOR=$HERDR_WORKING
export USAGE_CRIT_COLOR=$HERDR_BLOCKED

# ── Mic ─────────────────────────────────────────
export MIC_MUTE_COLOR=0xffe78a4e

# ── Battery ─────────────────────────────────────
export BATTERY_NORMAL_COLOR=$DARK_TEAL
export BATTERY_WARNING_COLOR=$MIC_MUTE_COLOR
