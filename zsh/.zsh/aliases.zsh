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

# Claude Code through the Headroom compression proxy (only where Headroom is installed).
# ~/.local/bin may not be on PATH yet when .zshrc sources this file, so test
# the default uv tool location too.
# Clients whose MCP entries read ${CONTEXT7_API_KEY}/${EXCALIDRAW_API_KEY} get those two keys
# from ~/secrets/.env through with-secrets, and no other key. Without a secrets file the client
# still starts, without those MCP keys; a readable file missing one of them stops the start.
_with_mcp_keys() {
  local client=$1
  shift
  if [[ -r ${SECRETS_ENV:-$HOME/secrets/.env} ]]; then
    "$HOME/dotfiles/scripts/with-secrets" CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- "$client" "$@"
  else
    command "$client" "$@"
  fi
}
claude() { _with_mcp_keys claude "$@"; }
opencode() { _with_mcp_keys opencode "$@"; }
codex() { _with_mcp_keys codex "$@"; }

if command -v headroom >/dev/null || [[ -x $HOME/.local/bin/headroom ]]; then
  alias hclaude="$HOME/dotfiles/scripts/headroom-prune; HEADROOM_TELEMETRY=off $HOME/dotfiles/scripts/with-secrets CONTEXT7_API_KEY EXCALIDRAW_API_KEY -- headroom wrap claude"
fi
