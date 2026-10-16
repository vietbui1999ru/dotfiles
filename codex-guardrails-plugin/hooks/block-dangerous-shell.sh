#!/usr/bin/env bash
input=$(cat)
command=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)
reason=""

wide_rm_re='rm[[:space:]]+-[[:alpha:]]*r[[:alpha:]]*f[[:space:]]+(/|~|"?\$HOME)'
force_push_re='git[[:space:]]+push[[:space:]].*(-f|--force).*(origin[[:space:]]+)?(main|master)'
remote_reset_re='git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+origin/'

if [[ "$command" =~ $wide_rm_re ]]; then
  reason="Blocked: recursive force removal targets root or home. Use a specific relative path."
elif [[ "$command" =~ $force_push_re ]]; then
  reason="Blocked: force push targets main or master."
elif [[ "$command" =~ $remote_reset_re ]]; then
  reason="Blocked: hard reset to a remote ref can discard local work."
fi

if [[ -n "$reason" ]]; then
  jq -n --arg reason "$reason" '{"decision":"block","reason":$reason}'
fi
