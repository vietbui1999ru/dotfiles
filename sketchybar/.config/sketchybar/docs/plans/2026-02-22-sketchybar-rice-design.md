# Sketchybar Rice Design

## Overview

Full rewrite of sketchybar config with a floating island aesthetic, teal color palette, and deep AeroSpace integration.

## Color Palette

| Name       | Hex       | Sketchybar     | Usage                                  |
|------------|-----------|----------------|----------------------------------------|
| Ice        | #EAF1F3   | 0xffEAF1F3     | Active text, active workspace icon     |
| Dark Teal  | #495755   | 0xff495755     | Bar background, pill backgrounds       |
| Sage       | #7B9C98   | 0xff7B9C98     | Inactive text, dim icons, separators   |
| Muted Teal | #72908D   | 0xff72908D     | Hover states, secondary highlights     |
| Bar BG     | —         | 0xe0495755     | Bar background with slight transparency|
| Active BG  | —         | 0x407B9C98     | Active workspace pill background       |
| Separator  | —         | 0x40EAF1F3     | Subtle vertical separators             |

## Bar Configuration

- Position: top
- Height: 37px
- Corner radius: 11px
- Margin: 8px (all sides, creating the floating island look)
- Y-offset: 4px
- Background: 0xe0495755 (dark teal, slight transparency)
- Blur radius: 30
- Notch width: 200 (avoids MacBook notch area)
- Displays on all monitors

## Layout

```
╭──────────────────────────────────────────────────────────────╮
│ [workspaces]  │  App · Window Title  │  ♫ Song  │ sys items │
│    LEFT        │      LEFT            │  CENTER  │   RIGHT   │
╰──────────────────────────────────────────────────────────────╯
```

## Left Side — Workspaces (Dynamic)

Dynamic workspace indicators using AeroSpace integration.

- Only show workspaces with windows + focused workspace
- Focused: Ice icon on Sage background pill
- Occupied (unfocused): Sage icon, no background
- Click to switch workspace via `aerospace workspace <name>`
- Updated via `aerospace_workspace_change` event trigger

### Workspace Icon Map

| Workspace | Icon | App(s)                    |
|-----------|------|---------------------------|
| B         |      | Browser (Brave/Firefox)   |
| T         |      | Terminal (Kitty)          |
| M         | 󰎆    | Music (Spotify)           |
| N         | 󰍩    | Notifications (Slack)     |
| O         | 󰏪    | Notes (Obsidian)          |
| P         |      | Programming (VSCode/etc)  |
| S         |      | Services (Postman/Docker) |
| C         | 󰭹    | Chat (ChatGPT/Claude)     |
| R         |      | Reading (Books/Preview)   |
| 0-3       | 0-3  | Numbered workspaces       |

## Left Side — Front App + Window Title

- Shows after workspace indicators
- App name in Ice color (SF Pro, bold)
- Window title in Sage color (SF Pro, regular, smaller)
- Separated by · dot
- Subscribes to front_app_switched event

## Center — Media / Now Playing

- Format: 󰎆  Artist — Track Name
- Color: Sage (subtle)
- Hidden when nothing is playing
- Click to toggle play/pause
- Max width truncation to prevent overflow
- Polls Spotify via osascript

## Right Side — System Items

Right-to-left order:

| Item       | Icons            | Update     | Details                              |
|------------|------------------|------------|--------------------------------------|
| Clock      |                 | 30s        | h:mm A or HH:mm format              |
| Battery    |  / 󰂄            | 120s+event | Icon varies by charge, color at <20% |
| Volume     | 󰕾 / 󰖀 / 󰝟       | event      | Icon varies: muted/low/med/high      |
| Wi-Fi      | 󰤨               | 30s        | Network name, icon if disconnected   |
| Brightness | 󰃟               | event      | Display brightness percentage        |

- Icons: Ice color
- Labels: Sage color
- Subtle vertical separators between groups (0x40EAF1F3)

## Fonts

- Icons: Hack Nerd Font Mono (already installed)
- Labels: SF Pro (already installed)

## Project Structure

```
~/.config/sketchybar/
├── sketchybarrc              # Main config: bar, defaults, item definitions
├── colors.sh                 # Color palette variables
├── icons.sh                  # Icon constants
├── plugins/
│   ├── aerospace.sh          # Dynamic workspace management
│   ├── front_app.sh          # Front app name + window title
│   ├── media.sh              # Now playing (Spotify etc.)
│   ├── clock.sh              # Time display
│   ├── battery.sh            # Battery status
│   ├── volume.sh             # Volume control
│   ├── wifi.sh               # Network status
│   └── brightness.sh         # Screen brightness
```

## AeroSpace Integration

- `exec-on-workspace-change` in aerospace.toml triggers `sketchybar --trigger aerospace_workspace_change`
- aerospace.sh subscribes to this event and dynamically updates workspace items
- Queries `aerospace list-workspaces` and `aerospace list-windows` to determine occupied workspaces

## Multi-Monitor Behavior

- Bar appears on all displays (built-in + external monitors)
- Floating island style works at any resolution (1440p, 1080p)
- Notch avoidance only applies to built-in MacBook display
- Workspaces shown per-monitor or globally (AeroSpace handles assignment)

## Approach

Shell-based (sketchybarrc + bash plugin scripts). Familiar, community-standard, works natively with AeroSpace triggers.
