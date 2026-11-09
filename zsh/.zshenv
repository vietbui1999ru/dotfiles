# Sourced for ALL zsh instances (login, non-login, scripts)
# Keep minimal — only PATH and env vars needed before .zshrc

[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"

# herdr and hc panes start non-login shells, which skip .zprofile. Without
# these, .zshrc cannot find mise on Linux and every mise-managed tool goes missing.
export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"

export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
