# Work Order — sketchybar follow-ups and verification

**For:** Pi (implementer) for items marked `[Pi]`; a Claude session for `[Claude]` (debugging and
verification, where each step depends on the last result); the owner for `[you]`.
**Repo:** `~/dotfiles`, package `sketchybar/` (stowed to `~/.config/sketchybar`). **Written:** 2026-09-23.
**Status:** nothing below is started. PR #41 is open and awaiting the owner.

This is the to-do for the next time sketchybar is worth revisiting. It records what a long
debugging-and-redesign session (2026-09-16 to 2026-09-23) established, what is still open, and how
to verify each thing. Read **Established facts** and **Decisions** first so nothing is re-derived
or re-litigated.

**Before you start** (traps that cost time this session):

1. **`agent-review` is live in `~/dotfiles`.** Every run of yours that changes a file produces a
   pending review and blocks your next input until resolved. Resolve with `:AgentReview` in
   Neovim, or set the gate's mode off for the duration and back on when done.
2. **The `rtk` wrapper discards top-level exit codes** (a failing command can look like exit 0)
   and can alter filtered text. Verify pass/fail by reading the output, or run through `sh -c`.
3. **Never run `sketchybarrc` directly.** Without `CONFIG_DIR` it sources `/colors.sh` and then
   fires real `sketchybar --add item` calls at the live bar (harmless "already exists" no-ops, but
   it applies nothing). Test it against a mock `sketchybar` on `PATH`: see `plugins/rc_profiles.test.sh`.
4. **Deploy is the owner's step, and it must be scoped.** The live checkout `~/dotfiles` is on
   `main` with unrelated uncommitted work from another Pi session (graphify), so `git merge` and
   `git pull` refuse. Use a scoped `git checkout origin/main -- <path>` per file. **Give one command
   per code block**: a multi-line paste was split by the shell once and executed `sketchybarrc`
   as a script.
5. **After the owner says "applied", diff the file on disk against the branch** before reloading.
   That report was wrong twice this session (`git show <ref>:<path> > /tmp/x; diff /tmp/x <live file>`).
6. **`~/.config/sketchybar` is a directory symlink into the repo** (verified), so new files appear
   with no restow. Resolve the real path before deleting or relinking anything under `~`.
7. **The Herdr bridge is a launchd Node process**, separate from sketchybar. `sketchybar --reload`
   does not restart it. It also re-pushes the `agents` label on every event, so a live
   `sketchybar --set agents label=...` test gets overwritten within seconds.
8. **Measuring in a live bar is treacherous.** A runtime `--set` on an already-laid-out item does
   not refresh its `--query` `bounding_rects` (they stay stale). Measure with a disposable
   `sketchybar --add item test_measure left --set ...` then `--remove test_measure`. The physical
   notch occludes any test item near the centre of a screenshot. `bounding_rects` is keyed per
   display (`display-1`, ...).
9. **Claude background sessions run in a worktree**, and the harness refuses git against the
   shared checkout (`cd`, `git -C`), refuses bare `git` (rtk rewrites it), and refuses shell loops,
   `bash -c`, and process substitution. Use `/usr/bin/git`, and put anything clever in a script file.
10. **Context7 MCP currently returns "Invalid API key".** Use Firecrawl for SketchyBar docs
    (`https://felixkratz.github.io/SketchyBar/config/bar` and `/items`).

---

## State of the world (verified 2026-09-23)

| Thing | State |
|---|---|
| `origin/main` sketchybar | equals the live checkout: icon-based agent status, `window_title` restored, `audio_source` toggles `drawing`, volume and battery removed, `MAX_ICONS=4`, `agents` `label.width=210`, no `label.width` on `space.*` |
| PR #41 `sketchybar-display-profiles` | **OPEN, mergeable.** Main-display-only bar + wide/compact profiles + overflow clamp + 3 new tests. **Not deployed, dual-display path never run live** |
| PRs #37, #38, #39 | OPEN but superseded. For `sketchybar/` and the bridge, #39's tree is identical to `main`; #37/#38 differ only by the older pre-revert state. Safe to close |
| Stale remote branches | `sketchybar-agent-icons`, `-combined`, `-reconcile`, `-revert-left-pill`, `-revert-left-pill-v2`, `-shrink-pills`, `worktree-sketchybar-balance-race`, `worktree-sketchybar-media-pill` |
| Displays attached | **one**: MAG 275UD E14, 5120x2880, macOS "looks like" 2560x1440. Internal (lid closed) not present |
| `~/.cache/sketchybar/profile` | absent (PR #41 not deployed) |

## Decisions already made — do not re-litigate

- **left_pill is bounded-dynamic (decided 2026-09-17).** Width tracks content, capped by `MAX_ICONS`
  with a `+N` badge; no fixed `label.width` on `space.*`. Resizing on workspace switch is
  *accepted*. The fixed-width version was tried and rejected: "looks kinda empty".
- `window_title` is back; `audio_source` toggles `drawing=off/on` again; volume and battery are gone.
- **agents label**: state lives in `scripts/herdr-sketchybar-bridge` (single writer, no shared state
  file, so no race). `agents.sh` only renders `LABEL`. Icons: plan = U+EF0D (fa-scroll), build =
  U+F08EA (md-hammer), NEXT = U+F101 (fa-angles-right), all verified present in
  `~/Library/Fonts/HackNerdFontMono-Regular.ttf`; SF Pro has none of them, so the item must use
  Hack Nerd Font Mono. idle/done show only their symbol.
- `balance_pills.sh`'s debounce, lock, and dirty-rerun stay. They fix real races (a reading of 444
  against a steady 511 was reproduced live).
- **Bar on the main display only; the external is not permanent (undock often); the external gets
  the fuller layout** (2026-09-21).
- Agents never merge PRs or deploy to the live checkout. The owner does.

## Established facts — verified, do not re-derive

**SketchyBar internals** (source, master, read 2026-09-21: `display.c`, `bar.c`, `bar_manager.c`):
- Item `display=N` indexes `SLSCopyManagedDisplays` (WindowServer order). It is not "main", and
  not left-to-right. With one display it is always 1, which is why the old `MAIN_DISPLAY=1` worked.
- Bar `display=main` follows `CGMainDisplayID()`. `notch_width`, `notch_offset`, and
  `notch_display_height` apply only to the built-in panel (`is_builtin`).
- `display_change` **does** fire on display add/remove/resize/move (`bar_manager_display_changed`
  resets the bars, then calls `bar_manager_handle_display_change`), and also when focus moves
  between displays. There is no separate hot-plug event.
- Aerospace's `monitor-appkit-nsscreen-screens-id` is an index into `NSScreen.screens`, whose
  first entry is the main screen. That is a different numbering from sketchybar's `display=`.

**Geometry:** bar `height=40`, `margin=7`, `y_offset=5`; items draw at y=5, so the bar's bottom
edge is about y=45. macOS menu bar and Dock are both auto-hidden. All sizes are points.
The internal panel's 1800x1169 "looks like" size is **inferred** from a 3600x2338 screenshot.

**Measured item widths** (disposable-item method, app-font 16, icon padding 5/4, label padding 5):
one workspace item = 42pt (1 icon), 69 (2), 96 (3), 143 (4 icons + `+2`). Label alone: 24, 51, 78, 104-107
(3 icons + badge). `agents` label widths were measured in **SF Pro Semibold 12**: status-only worst
case 200 ("? unknown" x2), working/working 197, idle/idle 146, with a NEXT suffix 344. **The font
is now Hack Nerd Font Mono 13, so those numbers are stale** (see item 4).

**Resize trail** (`~/.cache/sketchybar/balance.log`, 500-line cap, 2026-09-23 17:53 to 23:15, external only):
callers `agents` 241, `front_app` 138, `aerospace` 88, `audio_source` 33. Action `left_spacer`
499 times, `noop` once. Typical `lw` 373-385, `rw` 568-575, diff about 190.

**Other configs:** `aerospace/.aerospace.toml` `gaps.outer.top = [{ monitor."Built-in Retina Display" = 23 }, 60]`
with a stale comment ("37 bar + 15 margin + 15 y_offset" vs live 40/7/5); `workspace-to-monitor-force-assignment`
is fully commented out; kitty `font_size 20` is a fixed point size; tmux popups use percentages;
mouseless is already `auto`; nvim, starship, and herdr have nothing resolution-dependent.

**Pre-existing defects found on the way:** `ICON_CHEVRON=""` since the first commit `27eccbb`, so
the `chevron` item has never drawn anything; `ICON_VPN_OFF=""` is defined and never used.

---

## Work items

Priority: P0 unblocks everything, P1 is likely user-visible, P2 is tuning, P3 is housekeeping.

### 1. [you] then [Claude] — P0: verify and land PR #41

PR #41 cannot be trusted until it has run with two displays. Only the external was ever attached.

Deploy after the owner merges (one command per block; replace `<path>` with each file below):

```
git fetch origin
```
```
git checkout origin/main -- sketchybar/.config/sketchybar/<path>
```
```
sketchybar --reload
```

Paths: `profile.sh`, `sketchybarrc`, `colors.sh`, `README.md`, `plugins/display_profile.sh`,
`plugins/balance_pills.sh`, `plugins/aerospace.sh`, and the three `plugins/*.test.sh` files.
No bridge restart is needed; #41 does not touch it.

Checklist (Claude runs the queries; the owner does the plugging):

| # | Do | Expect |
|---|---|---|
| 1 | Reload with only the external attached | `cat ~/.cache/sketchybar/profile` is `PROFILE=wide`, `SCREEN_W=2560`, `HAS_NOTCH=0`; `sketchybar --query front_app` shows `width` 140 |
| 2 | Open the lid (external stays main) | bar on the external only, nothing on the internal; profile still `wide`; a workspace whose windows sit on the internal screen is hidden from the bar |
| 3 | Undock (unplug the external, lid open) | within about 2s the bar is on the internal panel; profile `compact`, `SCREEN_W` near 1800, `HAS_NOTCH=1`; `front_app` width 80; left and right pills clear the notch gap |
| 4 | Re-dock | back to `wide` |
| 5 | Move the mouse between screens | `stat -f %m ~/.cache/sketchybar/profile` unchanged (re-measures, never reloads) |
| 6 | `sketchybar --query displays` on the laptop | record the real frame width; confirm it classifies `compact` under `WIDE_MIN_W=2200` |

**If step 3 does not reload:** the assumption that `display_change` fires on unplug is
source-derived, not observed. Fallback: give `display_watch` an `update_freq=5` and have
`display_profile.sh` also compare a hash of `sketchybar --query displays` against the cache, so a
missed event is caught by the poll. Record what actually happened either way.

Acceptance: all six rows pass, or the failing row is documented with a fix plan.

### 2. [Claude] then [Pi] — P1: stop no-op rebalances from flickering

**Evidence:** in the resize trail, 499 of 500 runs re-applied the same ~190pt `left_spacer` padding.
`balance_pills.sh` zeroes both spacers, sleeps 0.05s, measures, then re-sets the same value, on
every call. `agents` (241) and `front_app` (138) are fixed-width items, so those calls cannot
change a pill's width at all. The `front_app` call was added purely for logging.

**Hypothesis (unconfirmed):** each run makes the left pill shrink by ~190pt for ~0.2s, visible on
every app switch and every agent event. This matches the earlier "visible flash" that PR #33 chased,
but it has **not** been reproduced visually in the current state.

**Step 1 [Claude] — confirm before building.** Screen-record (Cmd-Shift-5) while switching apps
several times. Also check the assumption the fix rests on: set `left_spacer width=100`, then
`sketchybar --query left_pill`. The pill width should grow by 100 (spacers are bracket members).

**Step 2 [Pi] — the change, if step 1 holds.** In `plugins/balance_pills.sh`: stop zeroing. Read
each spacer's current width (`sketchybar --query left_spacer` gives `geometry.width`), subtract it
from that pill's measured width to get the natural width, compute the target from natural widths
(keep the clamp and `limit`), and call `sketchybar --set` **only when the target differs from the
current spacer width**. Keep the generation token, lock, and dirty-rerun exactly as they are. The
`front_app` and `agents` calls can then stay (they become cheap query-only no-ops) or go.

Acceptance:
- New mock test: unchanged widths produce **zero** `--set` calls; a real change produces exactly one.
- `balance_pills.test.sh` and `balance_pills_clamp.test.sh` still pass.
- Live: after 30 minutes of normal use, at least 90% of `balance.log` lines are `noop`.
- If step 1 refutes the hypothesis, stop and record what the flicker actually is.

### 3. [you] — P1: decide the chevron

`ICON_CHEVRON` has been empty since `27eccbb`, so the `chevron` item (between the workspaces and
`front_app`) is an 11pt invisible spacer. Pick one:
- **Restore:** set a real glyph in `icons.sh` (candidate U+F054 fa-chevron-right; check it exists
  in the Hack Nerd Font cmap first, as the `EF0D`/`F08EA`/`F101` glyphs were checked) and delete
  the tolerance line in `plugins/rc_profiles.test.sh`.
- **Delete:** remove the item, its `left_pill` bracket entry, `ICON_CHEVRON`, and `CHEVRON_COLOR`.

Also delete the dead `ICON_VPN_OFF`. Acceptance: `plugins/rc_profiles.test.sh` passes with no
tolerance for empty values.

### 4. [Claude] then [Pi] — P1: re-measure `agents` width in the current font

The 210 (compact) and 420 (wide) widths came from SF Pro Semibold 12 measurements. The item now uses
Hack Nerd Font Mono Regular 13 (monospace, wider) and the label contains three PUA icons. Hypothesis:
compact 210 no longer fits `plan-icon ● working │ build-icon ● working` without scrolling.

Measure with a disposable `--add item ... label.font="Hack Nerd Font Mono:Regular:13.0"` using the
exact strings from `label()` in `scripts/herdr-sketchybar-bridge` (both roles `● working`, `! blocked`,
`? unknown`, `✓`, `○`, plus a typical NEXT line). Set `AGENTS_W` in `profile.sh` for both profiles.
Acceptance: compact fits the status-only string with no scrolling; wide also shows a typical NEXT
step. Update the comment above the `agents` item and the numbers in this file.

### 5. [Claude] — P1: check the laptop notch budget under real load

Budget (assumes 1800pt): `(1800 - 2*7 - 200) / 2 = 793pt` per pill. Compact keeps `MAX_ICONS=4`, and
the left pill is dynamic, so many busy workspaces could overrun. `balance_pills.sh` only *stops
padding* at the limit; it cannot shrink real content.

Test on the laptop panel with many workspaces open. Acceptance: with `clamped=1` in the log,
`left_pill` origin.x + width <= the notch's left edge and `right_pill` origin.x >= its right edge.
If the left pill's own content exceeds 793pt, raise it as an owner decision: lower the compact icon
cap, drop `window_title` on compact, or let `space.*` labels scroll.

### 6. [Claude] then [you] — P2: aerospace gaps

`gaps.outer.top` is 23 for the built-in display and 60 otherwise. **Hypothesis:** the built-in
`visibleFrame` starts at the notch inset (~37) and 37 + 23 = 60, so windows start at the same y
on both screens. With both attached, read a tiled window's top y on each screen (System Events
window position via `osascript`); expect the same offset from each screen's top. Also fix the stale
comment (`60  # 37 bar + 15 margin + 15 y_offset`) to the real 40/7/5 and decide whether the 15pt
gap under the bar (bar bottom about 45, windows at 60) is intended. Reload with `aerospace reload-config`.

### 7. [you] — P2: tune the wide profile after living with it

The wide numbers in `profile.sh` are estimates (about 6.2pt per SF Pro 12 character): `MAX_ICONS=6`,
`FRONT_APP_W=140`, `TITLE_W=380/60`, `AUDIO_W=200/32`, `AGENTS_W=420`. Adjust them only in
`profile.sh`; one file drives both profiles. Worst-case check: each pill must stay under
`(2560 - 14) / 2 = 1273pt`.

### 8. [Claude] — P2: decide whether to keep the resize logging

After item 2 lands and has run for a few days, summarise `balance.log` (callers, `noop` share,
`clamped`). If the trail is quiet, remove the `CALLER=` plumbing and the log, or keep it behind a
flag. Do not remove it before item 2.

### 9. [you] / [Pi] — P3: housekeeping

- Close #37, #38, #39. Verify first with `git diff --stat origin/main origin/<branch> -- sketchybar scripts/herdr-sketchybar-bridge`.
- Delete the stale remote branches listed above (owner decision; deletion is not reversible from here).
- `sketchybar/.config/sketchybar/README.md` still advertises Spotify popup, CPU graph, Pomodoro,
  Claude monitor, and a Spotify-era preview that are all disabled in `sketchybarrc`. Rewrite it to
  match reality (#41 already fixed the multi-monitor lines).
- `plugins/balance_pills.test.sh` is timing-sensitive: fixed `sleep 1` against a rerun that takes
  about 0.6s. It failed once under load, then passed 8/8. Replace the sleep with a bounded poll
  for the lock and dirty files to disappear.
- Fix or remove the Context7 MCP key.

### 10. Optional, only if it bothers you

- kitty `font_size 20` is fixed points, so text is physically about 20% larger on the external.
  Kitty cannot switch per display natively; a `display_change` hook calling `kitten @ set-font-size` could.
- Uncomment `[workspace-to-monitor-force-assignment]` in `.aerospace.toml` if workspaces wander
  between monitors when docked.

---

## Verification recipes

Run from the repo root. Each prints `ok`/`FAIL` lines and exits non-zero on failure. Read the
output; do not trust the exit code alone (see trap 2).

| What | Command | Expect |
|---|---|---|
| Overflow clamp | `bash sketchybar/.config/sketchybar/plugins/balance_pills_clamp.test.sh` | 4 `ok` |
| Balance contention | `bash sketchybar/.config/sketchybar/plugins/balance_pills.test.sh` | one summary line (timing-sensitive; rerun once before believing a failure) |
| rc for both profiles | `bash sketchybar/.config/sketchybar/plugins/rc_profiles.test.sh` | 20 `ok` (takes about 4s) |
| Non-main monitor logic | `bash sketchybar/.config/sketchybar/plugins/aerospace_monitor.test.sh` | 4 `ok` |
| Syntax | `bash -n <file>` for each touched `.sh` and `sketchybarrc` | no output |
| Profile detection | `XDG_CACHE_HOME=$(mktemp -d) sketchybar/.config/sketchybar/plugins/display_profile.sh detect` then read `$XDG_CACHE_HOME/sketchybar/profile` | external: `wide`, `2560`, `0` |
| Live displays | `sketchybar --query displays` | frames of attached displays |
| Live item size | `sketchybar --query <item>` then read `geometry.width` / `label.width` | matches `profile.sh` |
| Resize trail | read `~/.cache/sketchybar/balance.log` | see item 8 |
| Icons exist in the font | `fontTools` cmap on `~/Library/Fonts/HackNerdFontMono-Regular.ttf` | EF0D, F08EA, F101 present |

Mutation-check any new test: run it against the old behaviour (or a deliberately wrong value) and
confirm it fails. The clamp test fails against `main`'s unclamped script (pads 800, expected 593);
the rc test fails when a profile value is changed.

## Open questions for the owner

1. Chevron: restore a glyph or delete the item? (item 3)
2. When docked with the lid open, is "internal screen has no bar" right, or do you want a minimal bar there?
3. Is a workspace living on the internal screen being invisible in the bar acceptable while docked?
4. Compact profile under load (item 5): lower the icon cap, drop `window_title`, or scroll?
5. Keep the resize logging permanently, or retire it once item 2 is done?

## Definition of done for this whole plan

PR #41 merged and verified with two displays; no-op rebalances no longer flicker (item 2 confirmed
by screen recording, not just the log); `agents` widths re-measured in the current font; the chevron
decided; stale PRs and branches cleaned up; this file updated with what was actually observed.
