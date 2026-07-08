#!/usr/bin/env bash
# Catppuccin Macchiato palette (ANSI 256-color, mirrors starship.toml)
PEACH='\033[38;5;216m'
GREEN='\033[38;5;150m'
TEAL='\033[38;5;116m'
LAVENDER='\033[38;5;183m'
YELLOW='\033[38;5;222m'
RED='\033[38;5;210m'
SURFACE2='\033[38;5;60m'
MAUVE='\033[38;5;141m'
RESET='\033[0m'

input=$(cat)

cwd=$(echo "$input" | jq -r '.workspace.current_dir')
model=$(echo "$input" | jq -r '.model.display_name')
output_style=$(echo "$input" | jq -r '.output_style.name // empty')
context_used=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
session_pct=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
weekly_pct=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
vim_mode=$(echo "$input" | jq -r '.vim.mode // empty')
agent=$(echo "$input" | jq -r '.agent.name // empty')

# Vim mode: single char, no brackets
vim_info=""
if [ -n "$vim_mode" ]; then
  case "$vim_mode" in
    INSERT)  vim_info="$(printf "${TEAL}")I$(printf "${RESET}") " ;;
    VISUAL*) vim_info="$(printf "${MAUVE}")V$(printf "${RESET}") " ;;
    *)       vim_info="$(printf "${SURFACE2}")N$(printf "${RESET}") " ;;
  esac
fi

# Dir: last 2 segments under home, ~ anchor; basename at project root
if [ "$cwd" = "$HOME" ]; then
  short_dir="~"
else
  rel="${cwd#$HOME/}"
  if [ "$rel" = "$cwd" ]; then
    # not under home — last 2 segments
    short_dir=$(echo "$cwd" | awk -F/ '{if(NF>2) print $(NF-1)"/"$NF; else print $NF}')
  else
    # under home — last 2 segments of rel path
    depth=$(echo "$rel" | awk -F/ '{print NF}')
    if [ "$depth" -gt 1 ]; then
      short_dir=$(echo "$rel" | awk -F/ '{print $(NF-1)"/"$NF}')
    else
      short_dir="$rel"
    fi
  fi
fi

# Git branch + dirty + ahead/behind + stash + worktree
git_info=""
if git -C "$cwd" rev-parse --git-dir > /dev/null 2>&1; then
  branch=$(git -C "$cwd" --no-optional-locks branch --show-current 2>/dev/null)
  if [ -n "$branch" ]; then
    dirty=""
    if ! git -C "$cwd" --no-optional-locks diff --quiet 2>/dev/null || \
       ! git -C "$cwd" --no-optional-locks diff --cached --quiet 2>/dev/null; then
      dirty="*"
    fi

    # Ahead/behind — omit fetch, use cached remote ref
    remote=$(git -C "$cwd" --no-optional-locks rev-parse --abbrev-ref "${branch}@{upstream}" 2>/dev/null)
    remote_info=""
    if [ -n "$remote" ]; then
      counts=$(git -C "$cwd" --no-optional-locks rev-list --left-right --count "${remote}...HEAD" 2>/dev/null)
      behind=$(echo "$counts" | awk '{print $1}')
      ahead=$(echo "$counts"  | awk '{print $2}')
      [ "${ahead:-0}"  -gt 0 ] && remote_info="${remote_info} $(printf "${GREEN}")ahd:${ahead}$(printf "${RESET}")"
      [ "${behind:-0}" -gt 0 ] && remote_info="${remote_info} $(printf "${YELLOW}")bhd:${behind}$(printf "${RESET}")"
    else
      remote_info=" $(printf "${SURFACE2}")local$(printf "${RESET}")"
    fi

    # Stash count
    stash_info=""
    stash_count=$(git -C "$cwd" --no-optional-locks stash list 2>/dev/null | wc -l | tr -d ' ')
    [ "${stash_count:-0}" -gt 0 ] && stash_info=" $(printf "${PEACH}")stsh:${stash_count}$(printf "${RESET}")"

    # Worktree detection: resolve both to absolute before comparing
    # --git-dir can be relative from a subdirectory; --git-common-dir always is
    git_dir=$(git -C "$cwd" --no-optional-locks rev-parse --absolute-git-dir 2>/dev/null)
    common_dir=$(cd "$cwd" && git --no-optional-locks rev-parse --git-common-dir 2>/dev/null | xargs realpath 2>/dev/null)
    wt_info=""
    if [ "$git_dir" != "$common_dir" ]; then
      wt_name=$(basename "$(dirname "$git_dir")")
      wt_name="${wt_name#worktree-}"
      wt_info=" $(printf "${SURFACE2}")[wt:${wt_name}]$(printf "${RESET}")"
    fi

    if [ -n "$dirty" ]; then
      git_info=" $(printf "${YELLOW}")${branch}${dirty}$(printf "${RESET}")${remote_info}${stash_info}${wt_info}"
    else
      git_info=" $(printf "${GREEN}")${branch}$(printf "${RESET}")${remote_info}${stash_info}${wt_info}"
    fi
  fi
fi

# Persist context usage for hooks.
if [ -n "$context_used" ]; then
  cache_dir="$HOME/.claude/state"
  cache_file="$cache_dir/statusline-context.json"
  mkdir -p "$cache_dir" 2>/dev/null || true
  ctx_int=$(printf "%.0f" "$context_used" 2>/dev/null || echo "$context_used")
  ts=$(date +%s)
  printf '{"used_percentage":%s,"updated_at":%s}\n' "$ctx_int" "$ts" > "$cache_file.tmp" 2>/dev/null && mv "$cache_file.tmp" "$cache_file" 2>/dev/null || true
fi

# Context usage — warn before the 70% hook fires
ctx_info=""
if [ -n "$context_used" ]; then
  ctx_int=$(printf "%.0f" "$context_used" 2>/dev/null || echo "$context_used")
  if [ "$ctx_int" -ge 70 ] 2>/dev/null; then
    ctx_color="$RED"
  elif [ "$ctx_int" -ge 40 ] 2>/dev/null; then
    ctx_color="$YELLOW"
  else
    ctx_color="$GREEN"
  fi
  ctx_info=" $(printf "${ctx_color}")ctx:${ctx_int}%$(printf "${RESET}")"
fi

# Claude usage limits — 5h session window + 7d weekly window
limit_color() {
  pct_int="$1"
  if [ "$pct_int" -ge 90 ] 2>/dev/null; then
    printf "${RED}"
  elif [ "$pct_int" -ge 70 ] 2>/dev/null; then
    printf "${YELLOW}"
  else
    printf "${GREEN}"
  fi
}

session_info=""
if [ -n "$session_pct" ]; then
  session_int=$(printf "%.0f" "$session_pct" 2>/dev/null || echo "$session_pct")
  session_info=" $(limit_color "$session_int")5h:${session_int}%$(printf "${RESET}")"
fi

weekly_info=""
if [ -n "$weekly_pct" ]; then
  weekly_int=$(printf "%.0f" "$weekly_pct" 2>/dev/null || echo "$weekly_pct")
  weekly_info=" $(limit_color "$weekly_int")7d:${weekly_int}%$(printf "${RESET}")"
fi

# Agent: first segment only
agent_info=""
if [ -n "$agent" ]; then
  short_agent="${agent%%-*}"
  agent_info=" $(printf "${TEAL}")@${short_agent}$(printf "${RESET}")"
fi

# Output style (skip 'default')
style_info=""
[ -n "$output_style" ] && [ "$output_style" != "default" ] && \
  style_info=" $(printf "${SURFACE2}")[${output_style}]$(printf "${RESET}")"

# Model: strip 'claude-' prefix
short_model="${model#claude-}"

# Order: vim | dir | git | ctx% | 5h% | 7d% | agent | style | (model)
printf "%s$(printf "${PEACH}")%s$(printf "${RESET}")%s%s%s%s%s%s $(printf "${LAVENDER}")(%s)$(printf "${RESET}")" \
  "$vim_info" "$short_dir" "$git_info" "$ctx_info" "$session_info" "$weekly_info" "$agent_info" "$style_info" "$short_model"
