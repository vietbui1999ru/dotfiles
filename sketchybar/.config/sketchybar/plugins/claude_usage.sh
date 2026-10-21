#!/bin/bash
# Renders claude-tui's one-line usage summary. Absolute binary path because
# sketchybar's PATH lacks ~/.cargo/bin. Empty output or no binary means the
# daemon is not answering, so show that instead of a blank pill.

source "$CONFIG_DIR/colors.sh"

LABEL=$("$HOME/.cargo/bin/claude-tui" status --line 2>/dev/null)
[[ -z "$LABEL" ]] && LABEL="usage: daemon down"

case "$LABEL" in
  *"daemon down"*) COLOR=$MUTED_TEAL ;;
  *limit*)         COLOR=$USAGE_WARN_COLOR ;;
  *)               COLOR=$LABEL_COLOR ;;
esac

sketchybar --set "$NAME" label="$LABEL" label.color="$COLOR"
