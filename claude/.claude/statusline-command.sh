#!/usr/bin/env bash
# Backup status line, shown whenever the session-band band is not on screen. Each band draw rewrites
# ${TMPDIR:-/tmp}/session-band-<session_id>.drawn (at most every 5s; the band redraws every 15s while shown).
# Fresh .drawn -> print nothing. Missing or stale (no mod, /reload-plugins, a view that does not draw the band,
# crashed) -> draw this line. The timer's .alive file means "process alive" and is for the pueue lifecycle only.
# Input: Claude Code status JSON on stdin. Docs: https://code.claude.com/docs/en/statusline
# Segments: dir, worktree, branch, ctx headroom, 5h, 7d, output style, model.
# The stdin JSON is also snapshotted for the claude-tui daemon, which reads rate_limits and the file mtime.
input=$(cat)
snap_dir="$HOME/.local/state/claude-tui"
if mkdir -p "$snap_dir" 2>/dev/null && tmp=$(mktemp "$snap_dir/.claude-status.XXXXXX" 2>/dev/null); then
  printf '%s' "$input" >"$tmp" && mv -f "$tmp" "$snap_dir/claude-status.json" || rm -f "$tmp"
fi
command -v jq >/dev/null || { echo "statusline: jq missing"; exit 0; }
# Unit separator (0x1f), not tab: tab is IFS whitespace, so read would collapse empty fields.
IFS=$'\x1f' read -r cwd wt used left five seven style model < <(
  # ctx is percent of the 500K auto-compact cap (CLAUDE_CODE_AUTO_COMPACT_WINDOW), not of the
  # model window that used_percentage measures. Tokens come from current_usage.
  jq -r 'def cap_pct: (.context_window.current_usage // null) as $u
           | (if $u then (($u.input_tokens // 0) + ($u.cache_creation_input_tokens // 0) + ($u.cache_read_input_tokens // 0))
              elif .context_window.used_percentage then .context_window.used_percentage * (.context_window.context_window_size // 0) / 100
              else null end) as $t
           | if $t then $t / 5000 else null end;
         cap_pct as $p
         | [.workspace.current_dir // .cwd // "",
          .workspace.git_worktree // .worktree.name // "",
          ($p // ""),
          (if $p then ([100 - $p, 0] | max) else "" end),
          .rate_limits.five_hour.used_percentage // "",
          .rate_limits.seven_day.used_percentage // "",
          .output_style.name // "",
          .model.display_name // ""] | map(tostring) | join("\u001f")' <<<"$input"
)

# Current branch, unmarked: the status line marks a dirty tree, the band reads the branch only.
# Read before the .drawn exit only for a Herdr terminal's snapshot; otherwise after it.
branch_of() {
  [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1 \
    && git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null
}
br=""

# Snapshots for the Herdr band (ai-spend), which shows the focused Claude terminal's context, model
# and branch. by-terminal/<HC_TERMINAL_ID> serves a Claude running in the Herdr terminal itself.
# by-session/<session_id> serves a background job: its status line runs in the job's process, which
# has no HC_TERMINAL_ID, and ai-spend maps the terminal to the job through `claude attach`.
# Written every run, before the .drawn exit, so they stay current while the session band is on
# screen. Atomic, and skipped when the id is not a plain name.
write_snap() { # write_snap <subdir> <id>
  local dir="$snap_dir/$1" tmp
  mkdir -p "$dir" 2>/dev/null && tmp=$(mktemp "$dir/.snap.XXXXXX" 2>/dev/null) || return 0
  jq -n --arg used "$used" --arg model "${model#claude-}" --arg branch "$br" --argjson now "$(date +%s)" \
    '{ctx: (if $used == "" then null else ($used | tonumber | round) end), model: $model, branch: $branch, updated: $now}' >"$tmp" \
    && mv -f "$tmp" "$dir/$2.json" || rm -f "$tmp"
}
term="${HC_TERMINAL_ID:-}"
sid=$(jq -r '.session_id // empty' <<<"$input")
term_ok=""; [[ "$term" =~ ^[A-Za-z0-9._-]+$ ]] && term_ok=1
sid_ok=""; [[ "$sid" =~ ^[A-Za-z0-9_-]+$ ]] && sid_ok=1
if [ -n "$term_ok$sid_ok" ]; then
  br=$(branch_of)
  [ -n "$term_ok" ] && write_snap by-terminal "$term"
  [ -n "$sid_ok" ] && write_snap by-session "$sid"
fi

hb="${TMPDIR:-/tmp}/session-band-${sid}.drawn"
if [[ "$sid" =~ ^[A-Za-z0-9_-]+$ ]] && [ -f "$hb" ]; then
  mtime=$(stat -f %m "$hb" 2>/dev/null || stat -c %Y "$hb")
  [ $(( $(date +%s) - mtime )) -lt 60 ] && exit 0
fi
c() { printf '\033[%sm%s\033[0m' "$1" "$2"; }
# pct VALUE WARN CRIT -> green/yellow/red by threshold
tone() { awk -v v="$1" -v w="$2" -v c="$3" 'BEGIN{print (v>=c)?31:(v>=w)?33:32}'; }

dir=${cwd##*/}; [ "$cwd" = "$HOME" ] && dir="~"
out=$(c 34 "$dir")
[ -n "$wt" ] && out+=" $(c 35 "wt:$wt")"

[ -n "$br" ] || br=$(branch_of)
if [ -n "$br" ]; then
  dirty=""; git -C "$cwd" --no-optional-locks diff --quiet HEAD 2>/dev/null || dirty="*"
  out+=" $(c "$([ -n "$dirty" ] && echo 33 || echo 32)" "[$br$dirty]")"
fi

if [ -n "$used" ]; then
  out+=" $(c "$(tone "$used" 40 70)" "ctx:$(printf '%.0f' "$used")%")"
  [ -n "$left" ] && out+="$(c 90 " (${left%.*}% left)")"
fi
[ -n "$five" ] && out+=" $(c "$(tone "$five" 70 90)" "5h:$(printf '%.0f' "$five")%")"
[ -n "$seven" ] && out+=" $(c "$(tone "$seven" 70 90)" "7d:$(printf '%.0f' "$seven")%")"
[ -n "$style" ] && [ "$style" != "default" ] && out+=" $(c 90 "[$style]")"
[ -n "$model" ] && out+=" $(c 90 "(${model#claude-})")"
printf '%s' "$out"
