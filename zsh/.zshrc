# ── History ──────────────────────────────────────────────────────────
HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt HIST_IGNORE_DUPS HIST_IGNORE_SPACE SHARE_HISTORY INC_APPEND_HISTORY

# ── Completions ───────────────────────────────────────────────────────
autoload -Uz compinit
compinit -d "$XDG_CACHE_HOME/zsh/zcompdump-$ZSH_VERSION"
mkdir -p "$XDG_CACHE_HOME/zsh"

# ── Editor ────────────────────────────────────────────────────────────
export EDITOR='nvim'
[[ -n $SSH_CONNECTION ]] && export EDITOR='vim'

# ── PATH ──────────────────────────────────────────────────────────────
export PATH="$HOME/.local/bin:$PATH"
export PATH="$HOME/go/bin:$PATH"
export PATH="$HOME/.ghcup/bin:$PATH"

# ── Sheldon (plugins) ─────────────────────────────────────────────────
eval "$(sheldon source)"

# ── Starship (prompt) ─────────────────────────────────────────────────
eval "$(starship init zsh)"

# ── Tool inits ───────────────────────────────────────────────────────
eval "$(zoxide init zsh --cmd cd)"

# rbenv
if command -v rbenv &>/dev/null; then
  eval "$(rbenv init - zsh)"
fi

# pyenv
if command -v pyenv &>/dev/null; then
  export PYENV_ROOT="$HOME/.pyenv"
  export PATH="$PYENV_ROOT/bin:$PATH"
  eval "$(pyenv init --path)"
  eval "$(pyenv init -)"
  pyenv commands 2>/dev/null | grep -q 'virtualenv-init' && eval "$(pyenv virtualenv-init -)"
fi

# nvm
export NVM_DIR="$HOME/.nvm"
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh"
[[ -s "$NVM_DIR/bash_completion" ]] && . "$NVM_DIR/bash_completion"

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

# ── Machine-local overrides (not in git) ─────────────────────────────
[[ -f "$HOME/.zshrc.local" ]] && source "$HOME/.zshrc.local"
