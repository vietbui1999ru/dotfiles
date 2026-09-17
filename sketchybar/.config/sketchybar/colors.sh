#!/opt/homebrew/bin/bash

# ── Palette (Gruvbox Material Dark Soft, matches kitty) ──
export ICE=0xffd4be98
export DARK_TEAL=0xffd4be98
export SAGE=0xff7daea3
export MUTED_TEAL=0xff928374

# ── Display ──────────────────────────────────────
export MAIN_DISPLAY=1   # sketchybar display ID for the primary monitor

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

# ── Chevron ──────────────────────────────────────
export CHEVRON_COLOR=$SAGE

# ── Front App ────────────────────────────────────
export APP_NAME_COLOR=$DARK_TEAL
export WINDOW_TITLE_COLOR=$SAGE

# ── Audio source ─────────────────────────────────
export AUDIO_SOURCE_ICON_COLOR=$SAGE
export AUDIO_SOURCE_LABEL_COLOR=$SAGE

# ── VPN ──────────────────────────────────────────
export VPN_ON_COLOR=$SAGE
export VPN_OFF_COLOR=$MUTED_TEAL

# ── Mic ─────────────────────────────────────────
export MIC_MUTE_COLOR=0xffe78a4e
