# sketchybar

A [SketchyBar](https://github.com/FelixKratz/SketchyBar) config for macOS: two floating pills of equal width on either side of the notch, with deep [AeroSpace](https://github.com/nikitabobko/AeroSpace) integration and an agent-status item fed by Herdr.

## Layout

```
╭─ left_pill ──────────────────────────────────────╮      ╭─ right_pill ─────────────────────────────────────────╮
│ 󰼏 󰼐  󰖟 │ kitty · ~/dotfiles │ 󰕾 Spotify        │ notch │ 󰒍 󰕥 │ 󱐌 80% │ 󰍬 42% │ 󰨲 Tue 20 │ 󰺗 15:09 │ 󱚡 1● 5○ │
╰──────────────────────────────────────────────────╯      ╰──────────────────────────────────────────────────────╯
```

- **Workspaces**: one item per AeroSpace workspace, with app icons from `sketchybar-app-font`, capped per profile with a `+N` badge. Empty, unfocused workspaces and workspaces on another monitor are hidden.
- **Front app and window title**: fixed widths, and long titles scroll.
- **Audio source**: the app currently playing audio. It is hidden when nothing plays.
- **VPN**: Tailscale and ProtonVPN connection icons.
- **Battery**: percentage and level glyph, with a bolt on AC power.
- **Mic**: input volume. Click it to mute.
- **Date and clock**.
- **Agents**: Claude pane counts per status (`●` working, `!` blocked, `○` idle), a hammer segment while Pi tasks run in pueue, and the latest `NEXT:` step. Click it to jump to the Claude pane that most needs you.

## Static by design

Nothing on the bar animates or flickers:

- No item uses `--animate`.
- Every item whose text changes has a fixed width (`label.width`, sized in `profile.sh`), and long text scrolls instead of resizing the pill.
- `plugins/balance_pills.sh` keeps the pills equal by padding a spacer. It measures without touching the bar, and it sets a spacer only when its width actually changes, so a run with nothing to fix draws nothing. Only events that really change a pill's width call it: workspaces, audio source, and VPN.

## Files

```
sketchybarrc            bar, defaults, add_sep helper, events, then items in bar order
colors.sh  icons.sh     palette (Gruvbox Material Dark Soft) and Nerd Font glyphs
profile.sh              wide/compact sizes for the target display
items/                  one file per item group: what the item is (properties, events)
plugins/                one script per item: what it does at runtime
plugins/*.test.sh       mock-sketchybar tests (no live bar needed)
```

`scripts/herdr-sketchybar-bridge` (in the dotfiles root, run by launchd as `com.vietbui.herdr-sketchybar-bridge`) is the single writer of the agents label. It subscribes to Herdr's socket for Claude pane status and `NEXT:` output, and polls `pueue status` every 5s. It renders the label with `scripts/herdr-sketchybar-label.mjs` and pushes it with `sketchybar --trigger agent_state LABEL=...`.

## Dock/undock

There is one bar, and it always sits on the external display when one is attached. That is not necessarily the display macOS itself calls "main", and the two have been seen to disagree. `plugins/display_profile.sh` uses `CGDisplayIsBuiltin` to find the target display. It then maps the target to sketchybar's arrangement-id and to AeroSpace's NSScreen index, and caches a `wide` (≥ 2200pt) or `compact` profile. On `display_change`, it reloads the bar only if the target changed.

## Tests

```sh
bash plugins/rc_profiles.test.sh            # sketchybarrc for three display layouts
bash plugins/balance_pills_noop.test.sh     # no-op balance issues no --set
bash plugins/balance_pills_clamp.test.sh    # padding stops at what fits the screen
bash plugins/balance_pills.test.sh          # lock contention + dirty rerun
bash plugins/aerospace_monitor.test.sh      # workspaces on other monitors hide
node --test ../../../scripts/herdr-sketchybar-label.test.mjs
```

Never run `sketchybarrc` directly: without `CONFIG_DIR`, it fires real `--add` calls at the live bar.

## Reload

```sh
sketchybar --reload
launchctl kickstart -k gui/$(id -u)/com.vietbui.herdr-sketchybar-bridge   # after bridge changes
```

AeroSpace must trigger the workspace event. In `.aerospace.toml`:

```toml
exec-on-workspace-change = ['/bin/bash', '-c',
  'sketchybar --trigger aerospace_workspace_change FOCUSED_WORKSPACE=$AEROSPACE_FOCUSED_WORKSPACE']
```
