#!/usr/bin/env bash
# Backup status line, shown only when the session-band mod is dead. The mod draws the primary band above
# the prompt and rewrites ~/.claude/state/session-band-<session_id>.alive every 15s (session-band-plugin/hooks/heartbeat.ts).
# Fresh heartbeat -> print nothing. Missing or stale (no mod loaded, /reload-plugins, crashed) -> draw this line.
# Input: Claude Code status JSON on stdin. Docs: https://code.claude.com/docs/en/statusline
# Segments: dir, worktree, branch, ctx headroom, 5h, 7d, output style, model.
command -v jq >/dev/null || { echo "statusline: jq missing"; exit 0; }

input=$(cat)
# Unit separator (0x1f), not tab: tab is IFS whitespace, so read would collapse empty fields.
IFS=$'\x1f' read -r cwd wt used left five seven style model < <(
  jq -r '[.workspace.current_dir // .cwd // "",
          .workspace.git_worktree // .worktree.name // "",
          .context_window.used_percentage // "",
          .context_window.remaining_percentage // "",
          .rate_limits.five_hour.used_percentage // "",
          .rate_limits.seven_day.used_percentage // "",
          .output_style.name // "",
          .model.display_name // ""] | map(tostring) | join("\u001f")' <<<"$input"
)

sid=$(jq -r '.session_id // empty' <<<"$input")
hb="${TMPDIR:-/tmp}/session-band-${sid}.alive"
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

if [ -n "$cwd" ] && git -C "$cwd" rev-parse --git-dir >/dev/null 2>&1; then
  br=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
  if [ -n "$br" ]; then
    dirty=""; git -C "$cwd" --no-optional-locks diff --quiet HEAD 2>/dev/null || dirty="*"
    out+=" $(c "$([ -n "$dirty" ] && echo 33 || echo 32)" "[$br$dirty]")"
  fi
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
