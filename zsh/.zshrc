# ── History ──────────────────────────────────────────────────────────
[[ -o interactive ]] && stty -ixon 2>/dev/null


HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt HIST_IGNORE_DUPS HIST_IGNORE_SPACE SHARE_HISTORY INC_APPEND_HISTORY

# ── Completions ───────────────────────────────────────────────────────
: "${XDG_CACHE_HOME:=$HOME/.cache}"
mkdir -p "$XDG_CACHE_HOME/zsh"
autoload -Uz compinit
compinit -d "$XDG_CACHE_HOME/zsh/zcompdump-$ZSH_VERSION"

# ── Editor ────────────────────────────────────────────────────────────
export EDITOR='nvim'
[[ -n $SSH_CONNECTION ]] && export EDITOR='vim'

# ── PATH (login-shell PATH is in .zprofile; these are interactive-only additions) ──
export PATH="$HOME/.ghcup/bin:$PATH"
[[ -d /usr/local/go/bin ]] && export PATH="/usr/local/go/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"

# ── Sheldon (plugins) ─────────────────────────────────────────────────
eval "$(sheldon source)"

# ── Starship (prompt) ─────────────────────────────────────────────────
eval "$(starship init zsh)"

# mise (replaces pyenv, rbenv, nvm — activates shims and shell completions)
command -v mise &>/dev/null && eval "$(mise activate zsh)"

# direnv (after mise so .envrc can reference mise-managed tools)
command -v direnv &>/dev/null && eval "$(direnv hook zsh)"

# Context7 API key (for ctx7 CLI, Pi, OMP agents)
[[ -f "$HOME/secrets/.env" ]] && export CONTEXT7_API_KEY="$(grep '^CONTEXT7_API_KEY=' "$HOME/secrets/.env" | cut -d= -f2)"

# opam
[[ -r "$HOME/.opam/opam-init/init.zsh" ]] && source "$HOME/.opam/opam-init/init.zsh" &>/dev/null

# ── macOS specifics ───────────────────────────────────────────────────
if [[ $OSTYPE == darwin* ]]; then
  export APPLE_SSH_ADD_BEHAVIOR=1
  # Windsurf
  export PATH="$HOME/.codeium/windsurf/bin:$PATH"
  # D-Bus (launchd)
  [[ -n "$DBUS_LAUNCHD_SESSION_BUS_SOCKET" ]] && \
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$DBUS_LAUNCHD_SESSION_BUS_SOCKET"
  # Kitty socket for current instance
  [[ -n $KITTY_PID ]] && export KITTY_LISTEN_ON="unix:/tmp/mykitty-$KITTY_PID"
fi

# ── Aliases + functions ───────────────────────────────────────────────
source "$HOME/.zsh/aliases.zsh"
source "$HOME/.zsh/functions.zsh"
source "$HOME/.zsh/keybindings.zsh"

# Reset terminal state on each prompt — prevents TUI apps from leaving mouse reporting
# or keyboard protocol modes active after exit or tmux pane switch
_reset_terminal_modes() {
  printf '\e[?1000l\e[?1002l\e[?1003l\e[?1006l\e[?1015l'  # disable all mouse modes
  printf '\e[<999u'                                          # pop kitty keyboard protocol stack
}
precmd_functions+=(_reset_terminal_modes)

# Regenerate starship's palette from kitty's active theme whenever it changes
# (kitty +kitten themes rewrites current-theme.conf on every theme switch)
_sync_starship_theme() {
  local theme_file="$HOME/.config/kitty/current-theme.conf"
  local marker="$XDG_CACHE_HOME/starship-theme-sync.marker"
  [[ -f "$theme_file" ]] || return
  local mtime
  mtime=$(stat -f %m "$theme_file" 2>/dev/null || stat -c %Y "$theme_file" 2>/dev/null)
  if [[ "$(cat "$marker" 2>/dev/null)" != "$mtime" ]]; then
    "$HOME/.local/bin/kitty-theme-to-starship" &>/dev/null && echo "$mtime" >"$marker"
  fi
}
precmd_functions+=(_sync_starship_theme)

# ── rg / fzf integration ──────────────────────────────────────────────
if command -v rg >/dev/null 2>&1; then
  export FZF_DEFAULT_COMMAND='rg --files --hidden --follow --glob "!.git"'
  export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
fi

# ── Machine-local overrides (not in git) ─────────────────────────────
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"

# ── zoxide (must be last — interactive only) ──────────────────────────
[[ -o interactive ]] && eval "$(zoxide init zsh --cmd cd)"

# opencode
[[ -d "$HOME/.opencode/bin" ]] && export PATH="$HOME/.opencode/bin:$PATH"

# bun completions
[ -s "$HOME/.bun/_bun" ] && source "$HOME/.bun/_bun"

# bun
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$PATH"

. "$HOME/.local/share/../bin/env"
