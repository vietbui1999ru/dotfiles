# Plan: wire dotfiles to claude-tui v2 (Phase G)

Task: `.agents/claimed/claude-tui-v2-dotfiles-integration.md` in the main checkout (`~/dotfiles`).
JSON contract: `~/repos/LangSpecificProjects/RustProjects/claude-tui/docs/status-json.md`.
Run `~/.cargo/bin/claude-tui status --json` and `status --line` to see live output.

Work only in the current worktree. Commit after each numbered step, staging by path. Do not touch `~/repos/DiffViewer` or `~/repos/pi-live-status`. Do not push.

## Step 1 — Claude snapshot (`claude/.claude/statusline-command.sh`)

- Move `input=$(cat)` above the `jq` check. Immediately after it, write the snapshot atomically, before anything can exit:
  ```bash
  snap_dir="$HOME/.local/state/claude-tui"
  if mkdir -p "$snap_dir" 2>/dev/null && tmp=$(mktemp "$snap_dir/.claude-status.XXXXXX" 2>/dev/null); then
    printf '%s' "$input" >"$tmp" && mv -f "$tmp" "$snap_dir/claude-status.json" || rm -f "$tmp"
  fi
  ```
- Fix the line-3 comment: the heartbeat is `${TMPDIR:-/tmp}/session-band-<session_id>.alive`, not `~/.claude/state`. Add one comment line saying the stdin JSON is snapshotted for the claude-tui daemon (it reads `rate_limits` and the file mtime).
- Printed output stays unchanged.

## Step 2 — Sketchybar `claude_usage` item (`sketchybar/.config/sketchybar/`)

- `plugins/claude_usage.sh` (`#!/bin/bash`, sources `$CONFIG_DIR/colors.sh`): run `"$HOME/.cargo/bin/claude-tui" status --line 2>/dev/null`; empty output or missing binary → label `usage: daemon down`. Color: grey when the label matches `*daemon down*`, yellow when `*limit*`, else `$LABEL_COLOR`. Reuse colors from `colors.sh` (add one only if no grey/yellow exists). Finish with `sketchybar --set "$NAME" label="$LABEL" label.color="$COLOR"`. Reference: `~/repos/LangSpecificProjects/RustProjects/claude-tui/scripts/sketchybar/claude_plugin.sh`. Absolute binary path, because sketchybar's PATH lacks `~/.cargo/bin`.
- `items/claude_usage.sh`, in the style of `items/agents.sh`: `add_sep sep.claude_usage`, then `sketchybar --add item claude_usage right --set claude_usage icon.drawing=off label.width=$CLAUDE_USAGE_W label.max_chars=80 scroll_texts=on label.font="Hack Nerd Font Mono:Regular:13.0" update_freq=60 script="$PLUGIN_DIR/claude_usage.sh"`. Short header comment.
- `profile.sh`: `CLAUDE_USAGE_W=340` in the wide profile, `CLAUDE_USAGE_W=200` in the compact one, each with a one-line comment.
- `sketchybarrc`: `source "$ITEM_DIR/claude_usage.sh"` right after `vpn.sh` (leftmost item of the right pill).
- `items/brackets.sh`: add `sep.claude_usage claude_usage` to `right_pill` immediately after `right_spacer`, keeping the rest in order.

## Step 3 — Shell function

Delete the `claude-tui()` function in `zsh/.zsh/functions.zsh` (around line 36, plus one surrounding blank line). Leave `docs/superpowers/plans/2026-06-20-dotfiles-migration.md` alone (historical).

## Step 4 — Pi extensions read `claude-tui status --json` (`pi/.pi/agent/extensions/`)

- New `lib/claude-tui-status.mjs` (plain ESM with JSDoc, no dependencies; imported from both `.mjs` and `.ts`):
  - `export async function claudeTuiStatus({ exec = execFileAsync, ttlMs = 15_000, now = Date.now() } = {})`: module-level cache; runs `join(homedir(), ".cargo", "bin", "claude-tui")` with args `["status", "--json"]` and `{ timeout: 2000 }`; returns the parsed object. Any error, timeout, non-JSON output, `v !== 1`, or `daemon === "down"` returns `{ v: 1, daemon: "down" }`. Down results are cached too.
  - `export function formatCost(totals)`: missing totals or `cost_usd == null` → `"?"`; else `$X.XX` (below $0.01 → 3 decimals, at least $10 → rounded integer), prefixed `≈` when `cost_source === "computed"`.
  - `export function resetClaudeTuiCache()` for tests.
- New `lib/claude-tui-status.test.mjs` (`bun test`): down when exec throws; down on `{"v":1,"daemon":"down"}`; cache hit within TTL (fake exec called once); `formatCost` for reported, computed and null.
- `pi-side-panel/status-pane.mjs`:
  - Delete `parseOpencodeStats`, `piCostWindows`, `parseResetDuration`, `goUsageLimitState`, `goLimitCache`, `ocCache`, the old `opencodeUsageState`, `resetOpencodeCache`, and `tailFile` plus any import left unused. Keep `formatDuration`.
  - New `opencodeUsageState(exec)`: `const s = await claudeTuiStatus({ exec })`; down → `{ down: true }`; else `{ go: s.subscriptions["opencode-go"] }` (may be `null`). Update the call in `collectPanelData`.
  - Both renderers (plain, near the `lines.push("", "OPENCODE")`; styled, near `section(ICONS.opencode, ...)`): down → `usage: daemon down` (dim). Null `go` → `go no data`. Else `go today <formatCost(today)> · 7d <formatCost(last_7d)>`; when `last_quota_hit` is present: `GO <period ?? "?"> limit` (red when `reset_at` is in the future, dim otherwise), then `reset <formatDuration(reset_at - now)>` when in the future, else `seen <observed_at as local MM-DD HH:MM>`.
  - Keep `heartbeat()` and `.pi/panel.state.json` unchanged.
- `pi-statusline.ts` `usageLimitsSegment`:
  - Replace the whole `.pi/status` scan and the `readOpenAIUsage` call with `claudeTuiStatus()` from `./lib/claude-tui-status.mjs`. `cfg.piOpenAIUsage?.enabled === false` → return `""`.
  - Down → `dim(icons.sep) + dim("usage: daemon down")`. Null `chatgpt` subscription → `""`.
  - Else `color("OA", C.teal)` followed by quota windows from `chatgpt.quota`: `primary` → `5h:N%`, `secondary` → `wk:N%`, colored by `limitColor(used_pct)`; when `stale`, append `?` and use dim instead; skip windows that are `expired` or have `used_pct === null`. Then `today:<formatCost(today)>` and `7d:<formatCost(last_7d)>`. Keep the existing `dim(icons.sep) + dim(icons.limits)` prefix.
  - Drop `piStatuslineDailyCostLimit` / `piStatuslineWeeklyCostLimit` from the cfg type, the local `fmtCost` if now unused, and now-unused imports. Keep `limitColor` and the `piStatuslinePanelOwned` logic untouched.
- Delete `lib/openai-usage.ts`; replace `OpenAIUsageConfig` with an inline `{ enabled?: boolean }` type.

## Acceptance

- `rg -n "goUsageLimitState|piCostWindows|parseResetDuration|readOpenAIUsage" pi/` finds nothing.
- `bun test pi/.pi/agent/extensions/lib/claude-tui-status.test.mjs` passes.
- `bash -n` passes on the statusline script and both sketchybar scripts; `zsh -n zsh/.zsh/functions.zsh` passes.
- `node -e 'import("./pi/.pi/agent/extensions/pi-side-panel/status-pane.mjs")'` loads without error.
