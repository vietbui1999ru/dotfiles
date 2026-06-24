# ── History ──────────────────────────────────────────────────────────
[[ -o interactive ]] && stty -ixon 2>/dev/null

HISTFILE="$HOME/.zsh_history"
HISTSIZE=50000
SAVEHIST=50000
setopt HIST_IGNORE_DUPS HIST_IGNORE_SPACE SHARE_HISTORY INC_APPEND_HISTORY

# ── Completions ───────────────────────────────────────────────────────
autoload -Uz compinit
mkdir -p "$XDG_CACHE_HOME/zsh"
compinit -d "$XDG_CACHE_HOME/zsh/zcompdump-$ZSH_VERSION"

# ── Editor ────────────────────────────────────────────────────────────
export EDITOR='nvim'
[[ -n $SSH_CONNECTION ]] && export EDITOR='vim'

# ── PATH (login-shell PATH is in .zprofile; these are interactive-only additions) ──
export PATH="$HOME/.ghcup/bin:$PATH"

# ── SSH tmux auto-attach ──────────────────────────────────────────────
if [[ -z "$TMUX" && -n "$SSH_CONNECTION" ]]; then
  tmux attach-session -t main 2>/dev/null || tmux new-session -s main
fi

# ── Sheldon (plugins) ─────────────────────────────────────────────────
eval "$(sheldon source)"

# ── Starship (prompt) ─────────────────────────────────────────────────
eval "$(starship init zsh)"

# mise (replaces pyenv, rbenv, nvm — activates shims and shell completions)
command -v mise &>/dev/null && eval "$(mise activate zsh)"

# direnv (after mise so .envrc can reference mise-managed tools)
command -v direnv &>/dev/null && eval "$(direnv hook zsh)"

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
