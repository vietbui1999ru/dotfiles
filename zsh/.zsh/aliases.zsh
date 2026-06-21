# Navigation
alias clr="clear"
alias mkcd='f() { mkdir -p "$@" && cd "$_"; }; f'
alias lp='awk '\''BEGIN{RS=":"}{printf "Path %d: %s\n",++i,$0}'\'' <<<"$PATH"'

# Modern CLI replacements
alias ls="eza --icons --group-directories-first"
alias ll="eza -la --icons --group-directories-first --git"
alias lt="eza --tree --icons --level=2"
alias cat="bat --paging=never"
alias grep="rg"
alias find="fd"

# Git
alias acp='f() { git add . && git commit -a -s -m "$1" && git push; }; f'

# Editors
alias nv="nvimvenv"
alias luavim='cd ~/.config/nvim && nvim'
alias vimacp='f() { cd ~/.config/nvim/ && git add . && git commit -a -m "$1" && git push; }; f'

# Dotfiles
alias zc="nvim ~/.zshrc"
alias zf="cd ~/.zsh/ && nvim aliases.zsh"
alias zp="nvim ~/.zprofile"
alias sourced="source ~/.zshrc"

# Misc
alias python="python3"
alias obs='cd ~/repos/Obsidian/'
alias tpdf="termpdf.py"

# macOS-specific
if [[ $OSTYPE == darwin* ]]; then
  alias xcode="open -a Xcode"
  alias studio="open -a 'Android Studio.app'"
  alias sbrld="brew services reload sketchybar"
  alias s="kitten ssh"
  alias syncth="open http://127.0.0.1:8384/"
fi
