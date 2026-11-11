# Navigation
alias clr="clear"
unalias mkcd lp 2>/dev/null
mkcd() {
  mkdir -p "$@" && cd "$_"
}

lp() {
  awk 'BEGIN{RS=":"}{printf "Path %d: %s\n",++i,$0}' <<<"$PATH"
}

# Modern CLI replacements
alias ls="eza --icons --group-directories-first"
alias ll="eza -la --icons --group-directories-first --git"
alias lt="eza --tree --icons --level=2"
alias cat="bat --paging=never"
alias grep="rg"
alias find="fd"

# Git
unalias acp 2>/dev/null
acp() {
  git add . && git commit -a -s -m "$1" && git push
}

# Editors
alias nv="nvimvenv"
alias luavim='cd ~/.config/nvim && nvim'
unalias vimacp 2>/dev/null
vimacp() {
  cd ~/.config/nvim/ && git add . && git commit -a -m "$1" && git push
}

# Dotfiles
alias zc="nvim ~/.zshrc"
alias zf="cd ~/.zsh/ && nvim aliases.zsh"
alias zp="nvim ~/.zprofile"
# Restart rather than re-source: a second `source ~/.zshrc` makes
# fast-syntax-highlighting re-wrap deja's zle-line-init, and deja then chains to
# the wrapper as its "original", recursing until FUNCNEST on every prompt.
alias sourced="exec zsh"

# Misc
alias python="python3"
alias obs='cd ~/repos/Obsidian/'
alias tpdf="termpdf.py"

# Pi workflows
alias picp='pi -e "$HOME/.pi/agent/extensions-available/pi-control-plane.ts"'
alias pi-cp='pi -e "$HOME/.pi/agent/extensions-available/pi-control-plane.ts"'

alias inbox=' cd "/Volumes/100.100.100.100/buiquocviet99@gmail.com/proxmox/inbox" '

# Spec loop (alias, not PATH: scripts/ also holds a firecrawl wrapper that would shadow the real CLI)
alias spec="$HOME/dotfiles/scripts/spec"
alias ac-run="$HOME/dotfiles/scripts/ac-run"
alias floor-guard="$HOME/dotfiles/scripts/floor-guard"
alias agent-review="$HOME/dotfiles/scripts/agent-review"
alias focus="$HOME/dotfiles/scripts/focus"

# macOS-specific
if [[ $OSTYPE == darwin* ]]; then
  alias xcode="open -a Xcode"
  alias studio="open -a 'Android Studio.app'"
  alias sbrld="brew services reload sketchybar"
  alias s="kitten ssh"
  alias syncth="open http://127.0.0.1:8384/"
fi

# typos tracker

command_not_found_handler() {
  echo "$(date +%F) $1" >> ~/.cnf_log
  print -u2 "zsh: command not found: $1"; return 127
}

# NAV
alias ..="cd .."
alias ...="cd ../.."
alias ....="cd ../../.."
alias .....="cd ../../../.."


# TYPOS

alias gti="git"
alias gi="git"
alias nvmi="nvim"
alias nivm="nvim"
alias vnim="nvim"
alias nvi="nvim"

alias cd..="cd .."

alias claer="clear"
alias clea="clear"
alias crl="clear"
alias sl="ls"
alias la="ll"
alias pyhton="python3"
alias pytohn="python3"
alias dokcer="docker"
alias kubctl="kubectl"
alias souce="exec zsh"

# Clients whose MCP entries read ${CONTEXT7_API_KEY}/${EXCALIDRAW_API_KEY} get those two keys
# from ~/secrets/.env through with-secrets, and no other key. Both are optional: a key the file
# does not hold leaves that one MCP server unauthenticated, and a client that cannot start is a
# worse failure than a server that cannot. Without a secrets file the client also starts, without
# those MCP keys.
_with_mcp_keys() {
  local client=$1
  shift
  if [[ -r ${SECRETS_ENV:-$HOME/secrets/.env} ]]; then
    "$HOME/dotfiles/scripts/with-secrets" --optional CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- "$client" "$@"
  else
    command "$client" "$@"
  fi
}
claude() { _with_mcp_keys claude "$@"; }
opencode() { _with_mcp_keys opencode "$@"; }
codex() { _with_mcp_keys codex "$@"; }

# jj workspaces (docs/workflows/jj-workspaces-plan.md). jw creates a colocated
# workspace under .claude/worktrees/ on a real branch; jwc and jwb launch claude
# there through the wrapper above, so MCP keys are still injected.
_jw_dir() {
  local branch=$1 name=${1#*/} common
  common=$(git rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || return 1
  print -r -- "${common:h}/.claude/worktrees/$name"
}
_jw_ensure() {
  local dir
  dir=$(_jw_dir "$1") || return 1
  [[ -d $dir ]] || "$HOME/dotfiles/scripts/jw" new "$1" >/dev/null || return 1
  print -r -- "$dir"
}
jwc() {
  if [[ $# -ne 1 ]]; then
    print -u2 'usage: jwc <branch>'
    return 2
  fi
  local dir
  dir=$(_jw_ensure "$1") || return
  cd "$dir" && claude
}
jwb() {
  if [[ $# -ne 2 ]]; then
    print -u2 'usage: jwb <branch> <prompt>'
    return 2
  fi
  local dir
  dir=$(_jw_ensure "$1") || return
  ( cd "$dir" && claude --bg "$2" )
}

alias jw="$HOME/dotfiles/scripts/jw"

# Claude Code, Codex and Pi through the opt-in Headroom proxy launchers (only
# where Headroom is installed). Normal `claude`, `codex` and `pi` stay direct;
# the workflow script probes proxy identity and readiness before routing any
# traffic. Each launch first runs headroom-prune (keeps ~/.headroom private);
# Claude and Codex also get the two MCP keys through with-secrets.
# ~/.local/bin may not be on PATH yet when .zshrc sources this file, so test
# the default uv tool location too.
if command -v headroom >/dev/null || [[ -x $HOME/.local/bin/headroom ]]; then
  alias hclaude="$HOME/dotfiles/scripts/headroom-prune; HEADROOM_TELEMETRY=off $HOME/dotfiles/scripts/with-secrets --optional CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- $HOME/dotfiles/scripts/headroom-workflow claude"
  alias hcodex="$HOME/dotfiles/scripts/headroom-prune; HEADROOM_TELEMETRY=off $HOME/dotfiles/scripts/with-secrets --optional CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- $HOME/dotfiles/scripts/headroom-workflow codex"
  alias hpi="$HOME/dotfiles/scripts/headroom-prune; HEADROOM_TELEMETRY=off $HOME/dotfiles/scripts/headroom-workflow pi"
fi

# Mesh to pve2 (Tailscale node pve-2-1). See docs/workflows/herdr-paseo-mesh.md.
# p2 reads the pve2 Paseo daemon password from the macOS Keychain (paseo-pve2)
# on every call and hands it over in PASEO_HOST, not argv, so it stays out of
# this file, the shell history and other users' `ps`.
alias hx2="hc exec --on pve2"
alias herdr2="herdr --machine pve2"
if [[ $OSTYPE == darwin* ]]; then
  p2() {
    local pw
    pw=$(security find-generic-password -a "$USER" -s paseo-pve2 -w) || return
    PASEO_HOST="tcp://100.116.136.75:6767?password=$pw" paseo "$@"
  }
fi
