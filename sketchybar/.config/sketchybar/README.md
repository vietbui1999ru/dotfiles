# sketchybar-config

A custom [SketchyBar](https://github.com/FelixKratz/SketchyBar) setup for macOS featuring a floating island aesthetic, deep [AeroSpace](https://github.com/nikitabobko/AeroSpace) tiling WM integration, and a Spotify mini-player with transport controls.

![shell](https://img.shields.io/badge/shell-bash-informational)
![macOS](https://img.shields.io/badge/macOS-Sequoia-blue)

## Preview

```
╭──────────────────────────────────────────────────────────────────────────────╮
│  T   B  │  Ghostty · ~/projects  │  ♫ Artist — Track  │ 󰻠 12% │ 󰍬 │ 󰺗 9:41 │
│ workspaces │     front app        │     spotify        │    system items     │
╰──────────────────────────────────────────────────────────────────────────────╯
```

## Features

- **Dynamic workspaces** — AeroSpace-driven workspace indicators that show/hide based on window occupancy, with per-app icons via `sketchybar-app-font`, hover highlighting, and focus animations
- **Multi-monitor aware** — workspaces route to the correct display; items like battery, VPN, brightness, and Wi-Fi pin to the primary monitor
- **Spotify popup** — album art, track/artist/album info, progress scrubbing via slider, and full transport controls (shuffle, repeat, prev/play/next) — all rendered inside a SketchyBar popup
- **Live CPU graph** — 60-sample rolling graph with dynamic color thresholds
- **Pomodoro timer** — click-to-start countdown with configurable durations (popup menu), macOS system sounds on start/complete, and left/right-click control
- **Now-playing ticker** — auto-show/hide media label using `nowplaying-cli`, click to toggle playback
- **Claude AI monitor** — real-time session count, model, cost, and budget bar via Unix domain socket to a custom daemon
- **Mic toggle** — live input volume with mute state and click-to-toggle

## Architecture

```
~/.config/sketchybar/
├── sketchybarrc           # Bar config, defaults, item definitions, layout
├── colors.sh              # Centralized color palette (4 core colors)
├── icons.sh               # Nerd Font icon constants
├── items/
│   └── spotify.sh         # Spotify popup item definition (cover, info, controls, slider)
└── plugins/
    ├── aerospace.sh       # Workspace events: focus, hover, hide/show, per-monitor routing
    ├── front_app.sh       # Front app name + window title via AppleScript
    ├── spotify.sh         # Spotify control logic: play/pause, scrub, shuffle, repeat
    ├── cpu.sh             # CPU usage via top → graph push
    ├── battery.sh         # Battery level + charging state via pmset
    ├── brightness.sh      # Screen brightness via CoreGraphics (inline Swift)
    ├── timer.sh           # Pomodoro countdown with background process management
    ├── media.sh           # Generic now-playing via nowplaying-cli
    ├── volume.sh          # Volume level + icon tier via event subscription
    ├── mic.sh             # Input volume via osascript
    ├── vpn.sh             # Active VPN detection via scutil
    ├── wifi.sh            # Wi-Fi status via ipconfig
    ├── mic_click.sh       # Mic mute toggle
    ├── clock.sh           # Time display
    ├── calendar.sh        # Date display
    └── icon_map_fn.sh     # App name → sketchybar-app-font icon mapping (~400 apps)
```

## Tech Stack

| Layer | Tools |
|-------|-------|
| Bar engine | [SketchyBar](https://github.com/FelixKratz/SketchyBar) |
| Window manager | [AeroSpace](https://github.com/nikitabobko/AeroSpace) (tiling, workspace events) |
| Scripting | Bash, AppleScript (`osascript`), inline Swift (CoreGraphics) |
| System APIs | `pmset`, `scutil`, `ipconfig`, `top`, `nowplaying-cli` |
| IPC | Unix domain sockets (`socat`), SketchyBar event triggers |
| Fonts | [Hack Nerd Font Mono](https://www.nerdfonts.com/), SF Pro, [sketchybar-app-font](https://github.com/kvndrsslr/sketchybar-app-font) |

## Design

A muted teal palette inspired by fog on water:

| Token | Hex | Role |
|-------|-----|------|
| Ice | `#EAF1F3` | Bar background, primary text |
| Dark Teal | `#495755` | Icons, labels |
| Sage | `#7B9C98` | Accents, graph colors, secondary text |
| Muted Teal | `#72908D` | Inactive states, hover |

The bar floats as a rounded island (`corner_radius=11`, `margin=15`, `y_offset=15`) with blur and shadow, avoiding the MacBook notch with `notch_width=200`.

## Setup

### Dependencies

```sh
brew install --cask sf-symbols     # SF Pro font family
brew tap FelixKratz/formulae
brew install sketchybar
# AeroSpace: https://github.com/nikitabobko/AeroSpace
# Hack Nerd Font: https://www.nerdfonts.com/
# nowplaying-cli: brew install nowplaying-cli
```

### Install

```sh
git clone <repo-url> ~/.config/sketchybar
brew services start sketchybar
```

AeroSpace must trigger workspace change events. In `~/.aerospace.toml`:

```toml
exec-on-workspace-change = ['/bin/bash', '-c',
  'sketchybar --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE']
```

### Reload

```sh
sketchybar --reload
```

## Interesting Implementation Details

- **`aerospace.sh`** — Deduplicates app icons per workspace using a bash associative array as a seen-set, extracts monitor IDs from AeroSpace JSON to route workspaces to the correct physical display, and hides empty unfocused workspaces entirely
- **`brightness.sh`** — Calls `DisplayServicesGetBrightness` from Apple's private `DisplayServices.framework` via inline Swift compiled at runtime, since macOS provides no public CLI for display brightness
- **`timer.sh`** — Spawns a background countdown subprocess, stores its PID in `/tmp`, and uses `trap` + `wait` for clean signal handling so stopping the timer kills the sleep chain immediately
- **`spotify.sh`** — Implements seek-by-scrub: clicking the progress slider computes the target position as `(duration * click_percentage / 100)` and calls `set player position` via AppleScript
