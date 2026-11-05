#!/usr/bin/env bash
input=$(cat)
command=$(jq -r '.tool_input.command // ""' <<<"$input" 2>/dev/null)
reason=""

wide_rm_re='rm[[:space:]]+-[[:alpha:]]*r[[:alpha:]]*f[[:space:]]+(/|~|"?\$HOME)'
force_push_re='git[[:space:]]+push[[:space:]].*(-f|--force).*(origin[[:space:]]+)?(main|master)'
remote_reset_re='git[[:space:]]+reset[[:space:]]+--hard[[:space:]]+origin/'

# shared/AGENTS.md: keys live in ~/secrets/.env, one key comes out through
# scripts/secret-get. Claude Code's enforce-bash-safety.sh and Pi's secrets-guard
# extension enforce the same rule. Quotes and backslashes are dropped first, so
# ~/"sec"rets/.env is caught too; a longer name such as ~/secrets-backup is not.
secrets_dir="${HOME:-/nonexistent}/secrets"
secrets_quoted=$(printf '%s' "$secrets_dir" | sed 's/[][\\.*^$+?(){}|]/\\&/g')
secrets_bare=$(printf '%s' "$command" | sed -e 's/[\\]//g' -e 's/["]//g' -e "s/'//g")
secrets_tail='([^-A-Za-z0-9_]|$)'
secrets_re="(~/secrets|[$]HOME/secrets|[$][{]HOME[}]/secrets|${secrets_quoted})${secrets_tail}"

if [[ "$command" =~ $wide_rm_re ]]; then
  reason="Blocked: recursive force removal targets root or home. Use a specific relative path."
elif [[ "$command" =~ $force_push_re ]]; then
  reason="Blocked: force push targets main or master."
elif [[ "$secrets_bare" =~ $secrets_re ]]; then
  reason="Blocked: this command names $secrets_dir. Read one key with ~/dotfiles/scripts/secret-get NAME, or run a command with only the keys it needs through ~/dotfiles/scripts/with-secrets."
elif [[ "$command" =~ $remote_reset_re ]]; then
  reason="Blocked: hard reset to a remote ref can discard local work."
fi

if [[ -n "$reason" ]]; then
  jq -n --arg reason "$reason" '{"decision":"block","reason":$reason}'
fi
