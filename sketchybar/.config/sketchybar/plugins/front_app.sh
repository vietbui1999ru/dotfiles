#!/opt/homebrew/bin/bash

source "$CONFIG_DIR/colors.sh"

if [ "$SENDER" = "front_app_switched" ]; then
  sketchybar --set $NAME label="$INFO"

  # Update window title separately
  # Use osascript to get the window title of the frontmost app
  WINDOW_TITLE=$(osascript -e '
    tell application "System Events"
      set frontApp to first application process whose frontmost is true
      try
        set windowName to name of first window of frontApp
        return windowName
      on error
        return ""
      end try
    end tell
  ' 2>/dev/null)

  if [ -n "$WINDOW_TITLE" ] && [ "$WINDOW_TITLE" != "$INFO" ]; then
    sketchybar --set window_title label="· $WINDOW_TITLE"
  else
    sketchybar --set window_title label=""
  fi
fi
