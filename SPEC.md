---
status: draft
branch: feat/bar-usage-popup-agents-colors
---
# SPEC: lean usage popup and herdr-colored agents pill

## Objective
The right pill carries too much text. Shrink the claude-tui usage item to a colored icon whose quota rows live in a popup toggled by click or `alt-u`. Rework the agents item so status counts use herdr's own gruvbox status colors with readable glyph spacing, and the NEXT step shows as a short gist that scrolls at a fixed, readable speed when it overflows. Success: the pill is narrower, the urgency is readable by color at a glance, and the full quota numbers are one keypress away.

## Design decisions (from the grill, 2026-10-21)
- Herdr's socket carries `agent_status` only, not colors. Colors copy herdr's `gruvbox` status mapping from `src/client/shell.rs` (v0.9.5): blocked = red `0xfffb4934`, working = yellow `0xfffabd2f`, done = teal `0xff8ec07c`, idle = green `0xffb8bb26`, unknown = overlay0 `0xff928374`.
- Agents counts: only a blocked count (`!`) and a total (`∑`). A sketchybar label has one color, so the pill splits into items: robot icon, blocked, total, Pi, NEXT.
- Short NEXT: the bridge strips `(parentheticals)`, keeps the trailing `[tag]`, and keeps at most 5 words. Sessions keep writing full NEXT lines unchanged.
- Scroll: native sketchybar `scroll_texts`, linear, at about 45 px/s (6 chars/s at 7.8 px per Hack Nerd Font Mono 13 pt glyph). Speed is about `60 × W / scroll_duration` px/s for a visible width `W`, so `scroll_duration = round(60 × W / 45)` frames.
- Usage item: icon only, colored by the worst live quota % (green < 70, yellow 70–89, red ≥ 90, grey when the daemon is down or no live window). Popup rows: Claude, ChatGPT, OpenCode, built from `claude-tui status --json`. Toggle: click and aerospace `alt-u` (free).

## Acceptance Criteria
- AC-1: The usage bar item is icon-only and its color follows the worst non-stale, non-expired `used_pct` across subscriptions; daemon down gives grey
  verify: `bash sketchybar/.config/sketchybar/plugins/claude_usage.test.sh icon`
- AC-2: The popup has three rows (Claude, ChatGPT, OpenCode) with quota windows, today and 7d cost; a stale window ends in `?`, a computed cost starts with `≈`; daemon down gives one `usage: daemon down` row
  verify: `bash sketchybar/.config/sketchybar/plugins/claude_usage.test.sh popup`
- AC-3: Clicking the usage item and pressing `alt-u` both toggle the popup
  verify: `rg -q "alt-u = .*claude_usage popup.drawing=toggle" aerospace/.aerospace.toml`
- AC-4: The bridge's state renderer returns the blocked count, the total, the total's color (most urgent non-blocked status: working, then done, then idle) and the Pi count
  verify: `node --test scripts/herdr-sketchybar-label.test.mjs`
- AC-5: Short NEXT strips parentheticals, keeps the `[tag]` and caps at 5 words
  verify: `node --test --test-name-pattern="short NEXT" scripts/herdr-sketchybar-label.test.mjs`
- AC-6: The herdr status colors exist once in `colors.sh` with the exact hex values above
  verify: `bash -c 'f=sketchybar/.config/sketchybar/colors.sh; for c in 0xfffb4934 0xfffabd2f 0xff8ec07c 0xffb8bb26 0xff928374; do rg -q "$c" "$f" || exit 1; done'`
- AC-7: The NEXT item's `label.scroll_duration` comes from its width at 45 px/s in both profiles
  verify: `rg -q "NEXT_SCROLL=\\$\\(\\( \\(60 \\* NEXT_W \\+ 22\\) / 45 \\)\\)" sketchybar/.config/sketchybar/profile.sh`
- AC-8: Every changed shell script parses
  verify: `bash -c 'cd sketchybar/.config/sketchybar && for f in sketchybarrc profile.sh colors.sh items/*.sh plugins/agents.sh plugins/claude_usage.sh; do bash -n "$f" || exit 1; done'`
- AC-9: On the live bar the glyphs and counts have visible gaps, colors match herdr's sidebar, and the NEXT scroll reads comfortably
  verify: manual - visual judgement on the running bar

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` before claiming done
- Keep the bar static: fixed widths, no `--animate`
### Ask first
- New dependencies; changing how sessions write NEXT lines
### Never
- Edit a `verify:` line or a test to make a check pass
- Touch `~/repos/DiffViewer` or other repos

## Open Questions
- Blocked count at zero: show it or hide it? Default: dim grey `! 0`, so the pill keeps its shape.
- Pi task count: keep it? Default: keep the hammer item in yellow, hidden at 0.
- Agents click: keep "jump to the Claude pane that most needs you"? Default: yes, unchanged.
- Popup refresh: default: rows refresh on open and on the item's 60s tick, with no extra timer.
- `done` vs `idle`: default: both feed the total; its color is teal when any pane is done and none is working.
- This branch overwrites the unrelated `feat/agent-ref-guard` SPEC.md that sits on main. Default: when archiving this spec, restore that file from `origin/main`, so the PR leaves it unchanged.
