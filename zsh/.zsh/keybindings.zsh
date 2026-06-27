# ── Keybindings ──────────────────────────────────────────────────────
# Must be sourced AFTER plugins (sheldon/starship may silently set viins).
# bindkey -e forces emacs mode; explicit binds below survive any future
# plugin that touches the keymap.

bindkey -e

# Line navigation
bindkey '^A' beginning-of-line
bindkey '^E' end-of-line
bindkey '^B' backward-char
bindkey '^F' forward-char

# Word navigation — \e = Alt/Meta (works in Kitty on both macOS + Linux)
bindkey '\eb' backward-word
bindkey '\ef' forward-word
bindkey '\ed' kill-word
bindkey '\e^?' backward-kill-word   # Alt+Backspace

# Editing
bindkey '^K' kill-line
bindkey '^U' backward-kill-line
bindkey '^W' backward-kill-word
bindkey '^H' backward-delete-char
bindkey '^D' delete-char-or-list
bindkey '^Y' yank

# History
bindkey '^R' history-incremental-search-backward
bindkey '^P' up-line-or-history
bindkey '^N' down-line-or-history

# History-substring-search plugin (sheldon: zsh-history-substring-search)
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down

# Edit command in $EDITOR (zle widget registered in functions.zsh)
bindkey '^X^E' edit-command-line

# ── OS-specific overrides ─────────────────────────────────────────────
if [[ $OSTYPE == darwin* ]]; then
  : # macOS: Kitty handles Alt → \e natively; no extra binds needed
elif [[ $OSTYPE == linux* ]]; then
  : # Linux: placeholder — pull remote fix and fill in here
fi
