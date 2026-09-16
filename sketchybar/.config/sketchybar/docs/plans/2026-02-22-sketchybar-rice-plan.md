# Sketchybar Rice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rewrite sketchybar config with a floating island aesthetic, teal palette, dynamic AeroSpace workspace indicators, media center, and system status items.

**Architecture:** Shell-based config (`sketchybarrc` entry point) with modular plugin scripts in `plugins/`. Shared color and icon constants sourced by all scripts. AeroSpace integration via custom event triggers.

**Tech Stack:** Bash, sketchybar v2.23, AeroSpace, nowplaying-cli (for media), Hack Nerd Font Mono, SF Pro

**Design doc:** `docs/plans/2026-02-22-sketchybar-rice-design.md`

---

### Task 1: Install dependencies

**Files:** None (system packages)

**Step 1: Install nowplaying-cli for media info**

```bash
brew install nowplaying-cli
```

**Step 2: Install brightness CLI for display brightness**

```bash
brew install brightness
```

**Step 3: Verify both tools work**

```bash
nowplaying-cli get title  # Should return current track or empty
brightness -l             # Should list displays with brightness values
```

---

### Task 2: Create shared constants — colors.sh and icons.sh

**Files:**
- Create: `~/.config/sketchybar/colors.sh`
- Create: `~/.config/sketchybar/icons.sh`

**Step 1: Create colors.sh**

```bash
#!/bin/bash

# Palette: #EAF1F3 / #495755 / #7B9C98 / #72908D
export ICE=0xffEAF1F3
export DARK_TEAL=0xff495755
export SAGE=0xff7B9C98
export MUTED_TEAL=0xff72908D

# Derived
export BAR_COLOR=0xe0495755
export ACTIVE_BG=0x407B9C98
export SEPARATOR=0x40EAF1F3
export TRANSPARENT=0x00000000

# Semantic aliases
export ICON_COLOR=$ICE
export LABEL_COLOR=$SAGE
export ACTIVE_ICON=$ICE
export INACTIVE_ICON=$SAGE
export WARNING_COLOR=0xffE8967E  # Warm salmon for low battery
```

**Step 2: Create icons.sh**

```bash
#!/bin/bash

# Workspace icons (Nerd Font)
declare -A WORKSPACE_ICONS
WORKSPACE_ICONS=(
  [B]=""       # Browser
  [T]=""       # Terminal
  [M]="󰎆"      # Music
  [N]="󰍩"      # Notifications/Slack
  [O]="󰏪"      # Notes/Obsidian
  [P]=""       # Programming
  [S]=""       # Services
  [C]="󰭹"      # Chat
  [R]=""       # Reading
  [0]="0"
  [1]="1"
  [2]="2"
  [3]="3"
)

# System icons
export ICON_CLOCK=""
export ICON_CALENDAR=""
export ICON_WIFI="󰤨"
export ICON_WIFI_OFF="󰤭"
export ICON_VOLUME_HIGH="󰕾"
export ICON_VOLUME_MED="󰖀"
export ICON_VOLUME_LOW="󰕿"
export ICON_VOLUME_MUTE="󰝟"
export ICON_BATTERY_100=""
export ICON_BATTERY_75=""
export ICON_BATTERY_50=""
export ICON_BATTERY_25=""
export ICON_BATTERY_0=""
export ICON_BATTERY_CHARGING="󰂄"
export ICON_BRIGHTNESS="󰃟"
export ICON_MEDIA="󰎆"

# App icon (chevron separator after workspaces)
export ICON_CHEVRON=""
export ICON_SEPARATOR="│"
```

**Step 3: Make both executable**

```bash
chmod +x ~/.config/sketchybar/colors.sh ~/.config/sketchybar/icons.sh
```

**Step 4: Verify by sourcing**

```bash
source ~/.config/sketchybar/colors.sh && echo $ICE
source ~/.config/sketchybar/icons.sh && echo $ICON_CLOCK
```

Expected: `0xffEAF1F3` and clock icon glyph.

---

### Task 3: Write the main sketchybarrc

**Files:**
- Rewrite: `~/.config/sketchybar/sketchybarrc`

**Step 1: Write sketchybarrc**

This is the entry point. It sets up the bar, defaults, defines all items, and sources plugins.

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

PLUGIN_DIR="$CONFIG_DIR/plugins"

##### Bar Appearance #####
sketchybar --bar \
  position=top \
  height=37 \
  color=$BAR_COLOR \
  blur_radius=30 \
  corner_radius=11 \
  margin=8 \
  y_offset=4 \
  notch_width=200 \
  shadow=on \
  sticky=on

##### Defaults #####
default=(
  padding_left=4
  padding_right=4
  icon.font="Hack Nerd Font Mono:Bold:16.0"
  label.font="SF Pro:Semibold:13.0"
  icon.color=$ICON_COLOR
  label.color=$LABEL_COLOR
  icon.padding_left=4
  icon.padding_right=4
  label.padding_left=4
  label.padding_right=4
  background.corner_radius=8
  background.height=26
)
sketchybar --default "${default[@]}"

##### Custom Events #####
sketchybar --add event aerospace_workspace_change

##### Left Side — AeroSpace Workspaces #####
# Workspaces are added dynamically by the aerospace plugin.
# We add a single "trigger" item that runs the aerospace script on events.
sketchybar --add item aerospace_trigger left \
           --set aerospace_trigger \
                 drawing=off \
                 script="$PLUGIN_DIR/aerospace.sh" \
                 icon.drawing=off \
                 label.drawing=off \
           --subscribe aerospace_trigger aerospace_workspace_change space_windows_change front_app_switched

# Trigger initial workspace setup after a short delay
# (aerospace needs time to be ready)
sleep 0.5 && "$PLUGIN_DIR/aerospace.sh" &

##### Left Side — Chevron + Front App #####
sketchybar --add item chevron left \
           --set chevron \
                 icon=$ICON_CHEVRON \
                 icon.color=$SAGE \
                 icon.font="Hack Nerd Font Mono:Bold:12.0" \
                 label.drawing=off \
                 padding_left=2 \
                 padding_right=0

sketchybar --add item front_app left \
           --set front_app \
                 icon.drawing=off \
                 label.font="SF Pro:Bold:13.0" \
                 label.color=$ICE \
                 script="$PLUGIN_DIR/front_app.sh" \
           --subscribe front_app front_app_switched

sketchybar --add item window_title left \
           --set window_title \
                 icon.drawing=off \
                 label.font="SF Pro:Regular:12.0" \
                 label.color=$SAGE \
                 label.max_chars=50 \
                 scroll_texts=on \
                 script="$PLUGIN_DIR/front_app.sh" \
           --subscribe window_title front_app_switched

##### Center — Media #####
sketchybar --add item media center \
           --set media \
                 icon=$ICON_MEDIA \
                 icon.color=$SAGE \
                 icon.font="Hack Nerd Font Mono:Bold:16.0" \
                 label.color=$SAGE \
                 label.font="SF Pro:Regular:12.0" \
                 label.max_chars=40 \
                 scroll_texts=on \
                 drawing=off \
                 update_freq=5 \
                 script="$PLUGIN_DIR/media.sh" \
                 click_script="nowplaying-cli togglePlayPause" \
           --subscribe media media_change

##### Right Side — System Items #####
# Items are added right-to-left (first added = rightmost)

sketchybar --add item clock right \
           --set clock \
                 icon=$ICON_CLOCK \
                 update_freq=30 \
                 script="$PLUGIN_DIR/clock.sh"

sketchybar --add item separator_1 right \
           --set separator_1 \
                 icon=$ICON_SEPARATOR \
                 icon.color=$SEPARATOR \
                 icon.font="Hack Nerd Font Mono:Regular:16.0" \
                 icon.padding_left=6 \
                 icon.padding_right=6 \
                 label.drawing=off \
                 padding_left=0 \
                 padding_right=0

sketchybar --add item battery right \
           --set battery \
                 update_freq=120 \
                 script="$PLUGIN_DIR/battery.sh" \
           --subscribe battery system_woke power_source_change

sketchybar --add item separator_2 right \
           --set separator_2 \
                 icon=$ICON_SEPARATOR \
                 icon.color=$SEPARATOR \
                 icon.font="Hack Nerd Font Mono:Regular:16.0" \
                 icon.padding_left=6 \
                 icon.padding_right=6 \
                 label.drawing=off \
                 padding_left=0 \
                 padding_right=0

sketchybar --add item volume right \
           --set volume \
                 script="$PLUGIN_DIR/volume.sh" \
           --subscribe volume volume_change

sketchybar --add item separator_3 right \
           --set separator_3 \
                 icon=$ICON_SEPARATOR \
                 icon.color=$SEPARATOR \
                 icon.font="Hack Nerd Font Mono:Regular:16.0" \
                 icon.padding_left=6 \
                 icon.padding_right=6 \
                 label.drawing=off \
                 padding_left=0 \
                 padding_right=0

sketchybar --add item wifi right \
           --set wifi \
                 icon=$ICON_WIFI \
                 update_freq=30 \
                 script="$PLUGIN_DIR/wifi.sh"

sketchybar --add item separator_4 right \
           --set separator_4 \
                 icon=$ICON_SEPARATOR \
                 icon.color=$SEPARATOR \
                 icon.font="Hack Nerd Font Mono:Regular:16.0" \
                 icon.padding_left=6 \
                 icon.padding_right=6 \
                 label.drawing=off \
                 padding_left=0 \
                 padding_right=0

sketchybar --add item brightness right \
           --set brightness \
                 icon=$ICON_BRIGHTNESS \
                 update_freq=30 \
                 script="$PLUGIN_DIR/brightness.sh"

##### Force Initial Update #####
sketchybar --update
```

**Step 2: Make executable and verify syntax**

```bash
chmod +x ~/.config/sketchybar/sketchybarrc
bash -n ~/.config/sketchybar/sketchybarrc  # syntax check only
```

Expected: No output (clean syntax).

---

### Task 4: Write the AeroSpace workspace plugin (aerospace.sh)

This is the most complex script — it dynamically adds/removes workspace items based on which workspaces have windows.

**Files:**
- Create: `~/.config/sketchybar/plugins/aerospace.sh`

**Step 1: Write aerospace.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

# Get the currently focused workspace
FOCUSED_WORKSPACE="${FOCUSED_WORKSPACE:-$(aerospace list-workspaces --focused)}"

# Get all workspaces that have at least one window
OCCUPIED_WORKSPACES=$(aerospace list-workspaces --all --format "%{workspace}" --filter-non-empty 2>/dev/null || aerospace list-workspaces --monitor all)

# Build array of workspaces to show (occupied + focused)
declare -A SHOW_WORKSPACES
for ws in $OCCUPIED_WORKSPACES; do
  SHOW_WORKSPACES[$ws]=1
done
SHOW_WORKSPACES[$FOCUSED_WORKSPACE]=1

# Define workspace display order
ORDERED_WORKSPACES=("1" "2" "3" "0" "B" "T" "P" "C" "O" "N" "M" "S" "R")

# Remove all existing workspace items (they start with "ws.")
for ws in "${ORDERED_WORKSPACES[@]}"; do
  sketchybar --remove "ws.$ws" 2>/dev/null
done

# Add workspace items that should be visible
for ws in "${ORDERED_WORKSPACES[@]}"; do
  if [[ -n "${SHOW_WORKSPACES[$ws]}" ]]; then
    # Determine icon
    icon="${WORKSPACE_ICONS[$ws]:-$ws}"

    if [[ "$ws" == "$FOCUSED_WORKSPACE" ]]; then
      # Active workspace: Ice icon on Sage background
      sketchybar --add item "ws.$ws" left \
                 --set "ws.$ws" \
                       icon="$icon" \
                       icon.color=$ACTIVE_ICON \
                       icon.font="Hack Nerd Font Mono:Bold:16.0" \
                       icon.padding_left=8 \
                       icon.padding_right=8 \
                       label.drawing=off \
                       background.color=$ACTIVE_BG \
                       background.corner_radius=8 \
                       background.height=26 \
                       background.drawing=on \
                       click_script="aerospace workspace $ws" \
                 --move "ws.$ws" before chevron
    else
      # Inactive workspace: Sage icon, no background
      sketchybar --add item "ws.$ws" left \
                 --set "ws.$ws" \
                       icon="$icon" \
                       icon.color=$INACTIVE_ICON \
                       icon.font="Hack Nerd Font Mono:Bold:16.0" \
                       icon.padding_left=6 \
                       icon.padding_right=6 \
                       label.drawing=off \
                       background.drawing=off \
                       click_script="aerospace workspace $ws" \
                 --move "ws.$ws" before chevron
    fi
  fi
done
```

**Step 2: Make executable**

```bash
chmod +x ~/.config/sketchybar/plugins/aerospace.sh
```

**Step 3: Verify — reload sketchybar**

```bash
sketchybar --reload
```

Expected: Workspace icons appear on the left, only for occupied/focused workspaces. Active workspace has a highlighted pill background.

---

### Task 5: Write the front app plugin (front_app.sh)

**Files:**
- Rewrite: `~/.config/sketchybar/plugins/front_app.sh`

**Step 1: Write front_app.sh**

```bash
#!/bin/bash

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
```

**Step 2: Make executable and reload**

```bash
chmod +x ~/.config/sketchybar/plugins/front_app.sh
sketchybar --reload
```

Expected: App name appears in Ice color. Window title appears after "·" in Sage color. Switching apps updates both.

---

### Task 6: Write the media plugin (media.sh)

**Files:**
- Create: `~/.config/sketchybar/plugins/media.sh`

**Step 1: Write media.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

STATE=$(nowplaying-cli get playbackRate 2>/dev/null)
TITLE=$(nowplaying-cli get title 2>/dev/null)
ARTIST=$(nowplaying-cli get artist 2>/dev/null)

# Check if anything is playing (playbackRate > 0 or title exists)
if [ -n "$TITLE" ] && [ "$TITLE" != "null" ] && [ "$STATE" != "0" ]; then
  if [ -n "$ARTIST" ] && [ "$ARTIST" != "null" ]; then
    DISPLAY="$ARTIST — $TITLE"
  else
    DISPLAY="$TITLE"
  fi
  sketchybar --set $NAME drawing=on label="$DISPLAY"
else
  sketchybar --set $NAME drawing=off
fi
```

**Step 2: Make executable and reload**

```bash
chmod +x ~/.config/sketchybar/plugins/media.sh
sketchybar --reload
```

Expected: When Spotify is playing, center shows "Artist — Track". When paused/stopped, center is hidden. Clicking toggles play/pause.

---

### Task 7: Write the right-side system plugins

**Files:**
- Rewrite: `~/.config/sketchybar/plugins/clock.sh`
- Rewrite: `~/.config/sketchybar/plugins/battery.sh`
- Rewrite: `~/.config/sketchybar/plugins/volume.sh`
- Create: `~/.config/sketchybar/plugins/wifi.sh`
- Create: `~/.config/sketchybar/plugins/brightness.sh`

**Step 1: Write clock.sh**

```bash
#!/bin/bash
sketchybar --set $NAME label="$(date '+%I:%M %p')"
```

**Step 2: Write battery.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

PERCENTAGE=$(pmset -g batt | grep -Eo "\d+%" | head -1 | tr -d '%')
CHARGING=$(pmset -g batt | grep -c "AC Power")

if [ "$CHARGING" -gt 0 ]; then
  ICON=$ICON_BATTERY_CHARGING
  COLOR=$ICE
elif [ "$PERCENTAGE" -gt 75 ]; then
  ICON=$ICON_BATTERY_100
  COLOR=$ICE
elif [ "$PERCENTAGE" -gt 50 ]; then
  ICON=$ICON_BATTERY_75
  COLOR=$ICE
elif [ "$PERCENTAGE" -gt 25 ]; then
  ICON=$ICON_BATTERY_50
  COLOR=$ICE
elif [ "$PERCENTAGE" -gt 10 ]; then
  ICON=$ICON_BATTERY_25
  COLOR=$WARNING_COLOR
else
  ICON=$ICON_BATTERY_0
  COLOR=$WARNING_COLOR
fi

sketchybar --set $NAME icon="$ICON" icon.color=$COLOR label="${PERCENTAGE}%"
```

**Step 3: Write volume.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

VOLUME=$(osascript -e 'output volume of (get volume settings)')
MUTED=$(osascript -e 'output muted of (get volume settings)')

if [ "$MUTED" = "true" ] || [ "$VOLUME" -eq 0 ]; then
  ICON=$ICON_VOLUME_MUTE
elif [ "$VOLUME" -lt 30 ]; then
  ICON=$ICON_VOLUME_LOW
elif [ "$VOLUME" -lt 60 ]; then
  ICON=$ICON_VOLUME_MED
else
  ICON=$ICON_VOLUME_HIGH
fi

sketchybar --set $NAME icon="$ICON" label="${VOLUME}%"
```

**Step 4: Write wifi.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

SSID=$(/System/Library/PrivateFrameworks/Apple80211.framework/Resources/airport -I 2>/dev/null | awk -F': ' '/ SSID/{print $2}')

if [ -z "$SSID" ]; then
  sketchybar --set $NAME icon=$ICON_WIFI_OFF label="Off"
else
  sketchybar --set $NAME icon=$ICON_WIFI label="$SSID"
fi
```

**Step 5: Write brightness.sh**

```bash
#!/bin/bash

source "$CONFIG_DIR/colors.sh"
source "$CONFIG_DIR/icons.sh"

# brightness -l outputs lines like "display 0: brightness 0.582031"
BRIGHTNESS=$(brightness -l 2>/dev/null | grep "brightness" | head -1 | awk '{printf "%.0f", $NF * 100}')

if [ -z "$BRIGHTNESS" ]; then
  BRIGHTNESS="N/A"
fi

sketchybar --set $NAME icon=$ICON_BRIGHTNESS label="${BRIGHTNESS}%"
```

**Step 6: Make all executable and reload**

```bash
chmod +x ~/.config/sketchybar/plugins/{clock,battery,volume,wifi,brightness}.sh
sketchybar --reload
```

Expected: All right-side items show with correct icons and live data.

---

### Task 8: Clean up and remove old files

**Files:**
- Remove: `~/.config/sketchybar/plugins/space.sh` (unused, replaced by aerospace.sh)

**Step 1: Remove unused plugin**

```bash
rm ~/.config/sketchybar/plugins/space.sh
```

**Step 2: Full reload and visual verification**

```bash
sketchybar --reload
```

Expected: Full bar renders as designed — floating island, teal palette, dynamic workspaces on left, app+title, media center, system items on right.

---

### Task 9: Update AeroSpace config for notch gap

The AeroSpace config already has the `outer.top` gap set for the built-in display (11px) and external monitors (41px for bar). We need to bump the external monitor gap slightly to account for the floating bar's margin and y-offset.

**Files:**
- Modify: `~/.aerospace.toml` (lines 71-80, gaps section)

**Step 1: Update gaps**

Change `outer.top` default from `41` to `49` (37px bar height + 8px margin + 4px y_offset):

```toml
[gaps]
    inner.horizontal = 11
    inner.vertical =   11
    outer.left =       11
    outer.bottom =     11
    outer.top = [
      { monitor."Built-in Retina Display" = 11 },
      49  # 37 bar + 8 margin + 4 y_offset
    ]
    outer.right =      11
```

**Step 2: Reload AeroSpace**

Press `alt-shift-a` then `r` (service mode > reload) or:

```bash
aerospace reload-config
```

Expected: Windows on external monitors have proper gap below the floating bar.

---

### Task 10: Final integration test

**Step 1: Full restart**

```bash
sketchybar --reload
```

**Step 2: Verify each component**

- [ ] Bar floats with rounded corners and margins on all displays
- [ ] Notch area is avoided on MacBook display
- [ ] Workspace icons appear for occupied workspaces only
- [ ] Switching workspaces (alt+key) updates the active highlight
- [ ] Front app name + window title update when switching apps
- [ ] Media shows when Spotify is playing, hides when stopped
- [ ] Clock displays correct time
- [ ] Battery shows percentage with correct icon
- [ ] Volume responds to volume changes
- [ ] Wi-Fi shows current network name
- [ ] Brightness shows current percentage
- [ ] Color palette is consistent across all items
