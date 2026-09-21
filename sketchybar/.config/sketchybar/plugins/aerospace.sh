#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"
source "$CONFIG_DIR/plugins/icon_map_fn.sh"
source "$CONFIG_DIR/profile.sh"   # MAX_ICONS for the current main display

# Workspace ID passed as first argument by sketchybarrc
SID="$1"

# --- Helper: set active (focused) styling ---
set_active() {
  sketchybar --animate sin 10 --set "$NAME" \
    y_offset=10 y_offset=0 \
    drawing=on \
    icon.color=$WORKSPACE_ACTIVE_ICON \
    label.color=$WORKSPACE_ACTIVE_ICON \
    background.drawing=on \
    background.color=$WORKSPACE_ACTIVE_BG
}

# --- Helper: set inactive (unfocused) styling ---
set_inactive() {
  sketchybar --set "$NAME" \
    drawing=on \
    icon.color=$WORKSPACE_INACTIVE_ICON \
    label.color=$WORKSPACE_INACTIVE_ICON \
    background.drawing=off
}

# --- Helper: hide the item entirely ---
set_hidden() {
  sketchybar --set "$NAME" drawing=off
}

# --- Event handling ---
case "$SENDER" in

  # ── Hover enter ─────────────────────────────────────
  mouse.entered)
    FOCUSED=$(aerospace list-workspaces --focused 2>/dev/null)
    # Skip if already focused (already highlighted)
    if [[ "$SID" == "$FOCUSED" ]]; then
      exit 0
    fi
    sketchybar --set "$NAME" \
      background.drawing=on \
      background.color=$WORKSPACE_ACTIVE_BG \
      icon.color=$WORKSPACE_ACTIVE_ICON \
      label.color=$WORKSPACE_ACTIVE_ICON
    ;;

  # ── Hover exit ──────────────────────────────────────
  mouse.exited)
    FOCUSED=$(aerospace list-workspaces --focused 2>/dev/null)
    # Skip if focused (keep highlight)
    if [[ "$SID" == "$FOCUSED" ]]; then
      exit 0
    fi
    sketchybar --set "$NAME" \
      background.drawing=off \
      icon.color=$WORKSPACE_INACTIVE_ICON \
      label.color=$WORKSPACE_INACTIVE_ICON
    ;;

  # ── Workspace / display / wake events ───────────────
  *)
    FOCUSED=$(aerospace list-workspaces --focused 2>/dev/null)

    # Query windows in this workspace (JSON with monitor-id and app-name)
    WINDOW_JSON=$(aerospace list-windows --workspace "$SID" --json \
      --format '%{monitor-appkit-nsscreen-screens-id}%{app-name}' 2>/dev/null)

    # Build app icon string from window list, capped at MAX_ICONS distinct
    # apps (from profile.sh: 6 on a wide display, 4 on the laptop) — item
    # width tracks content (dynamic, no label.width), so this cap only bounds
    # how wide the item can grow, not a fixed box. Apps beyond the cap
    # collapse into a "+N" badge instead of being silently dropped.
    icons=""
    monitor=""
    icon_count=0
    overflow=0

    if [[ -n "$WINDOW_JSON" && "$WINDOW_JSON" != "[]" ]]; then
      # Use a seen-set to deduplicate app names
      declare -A seen_apps

      while IFS= read -r app_name; do
        # Skip empty names
        [[ -z "$app_name" ]] && continue
        # Skip duplicates
        [[ -n "${seen_apps[$app_name]}" ]] && continue
        seen_apps[$app_name]=1

        if (( icon_count < MAX_ICONS )); then
          # Map app name to sketchybar-app-font icon
          __icon_map "$app_name"
          icons+="${icon_result} "
          (( icon_count++ ))
        else
          (( overflow++ ))
        fi
      done < <(echo "$WINDOW_JSON" | sed -n 's/.*"app-name" *: *"\([^"]*\)".*/\1/p')

      (( overflow > 0 )) && icons+="+${overflow} "

      # Extract monitor ID from first window entry (default "1")
      monitor=$(echo "$WINDOW_JSON" | sed -n 's/.*"monitor-appkit-nsscreen-screens-id" *: *\([0-9]*\).*/\1/p' | head -1)
    fi

    # Remove trailing space
    icons="${icons% }"
    # Default monitor to 1 if not found
    monitor="${monitor:-1}"

    # The bar exists only on the main display, which is NSScreen index 1 by
    # definition. A workspace whose windows sit on another monitor has no bar
    # to draw on there, so hide it. (Don't pass $monitor to sketchybar's
    # display=: that's an index into a different, WindowServer-ordered list.)
    if [[ "$monitor" != "1" ]]; then
      set_hidden
    elif [[ -z "$icons" && "$SID" != "$FOCUSED" ]]; then
      # Empty unfocused workspace → hide
      set_hidden
    elif [[ "$SID" == "$FOCUSED" ]]; then
      # Focused workspace → active styling + animation
      set_active
      sketchybar --set "$NAME" label="$icons"
    else
      # Unfocused with apps → inactive styling
      set_inactive
      sketchybar --set "$NAME" label="$icons"
    fi
    # Space label/drawing above can change left_pill's width — rebalance.
    CALLER=aerospace "$CONFIG_DIR/plugins/balance_pills.sh"
    ;;
esac
