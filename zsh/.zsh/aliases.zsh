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
alias sourced="source ~/.zshrc"

# Misc
alias python="python3"
alias obs='cd ~/repos/Obsidian/'
alias tpdf="termpdf.py"

# Pi workflows
alias picp='pi -e "$HOME/.pi/agent/extensions-available/pi-control-plane.ts"'
alias pi-cp='pi -e "$HOME/.pi/agent/extensions-available/pi-control-plane.ts"'

# macOS-specific
if [[ $OSTYPE == darwin* ]]; then
  alias xcode="open -a Xcode"
  alias studio="open -a 'Android Studio.app'"
  alias sbrld="brew services reload sketchybar"
  alias s="kitten ssh"
  alias syncth="open http://127.0.0.1:8384/"
fi
