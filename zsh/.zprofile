# Login shell setup — sourced once per session, before .zshrc
# macOS: Terminal/Kitty/SSH all open login shells

# ── Homebrew ──────────────────────────────────────────────────────────
if [[ $OSTYPE == darwin* ]]; then
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

# ── Language toolchains (PATH only — inits in .zshrc) ────────────────
[[ -f "$HOME/.elan/env" ]] && source "$HOME/.elan/env"
[[ -f "$HOME/.ghcup/env" ]] && source "$HOME/.ghcup/env"

# Go: compiler binary (Linux tarball installs here; macOS via Homebrew already in PATH)
[[ -d /usr/local/go/bin ]] && export PATH="/usr/local/go/bin:$PATH"
# Go: user-installed tools (go install ...)
export PATH="$HOME/go/bin:$PATH"

# uv (Python toolchain manager — installs to ~/.local/bin on Linux, Homebrew on macOS)
export PATH="$HOME/.local/bin:$PATH"

# bun global binaries (omp, etc.)
export PATH="$HOME/.bun/bin:$PATH"

# ── macOS-specific paths ──────────────────────────────────────────────
if [[ $OSTYPE == darwin* ]]; then
  export ANDROID_SDK_ROOT="$HOME/Library/Android/sdk"
  export PATH="$PATH:$ANDROID_SDK_ROOT/emulator"
  export PATH="$PATH:$ANDROID_SDK_ROOT/platform-tools"

  export PATH="$HOME/.docker/bin:$PATH"
  export PATH="$HOME/.opam/default/bin:$PATH"

  # postgresql@18 is keg-only — must be explicit
  export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"

  # OpenBLAS compile flags (for numpy/ML source builds)
  if _oblas="$(brew --prefix openblas 2>/dev/null)" && [[ -d "$_oblas" ]]; then
    export LDFLAGS="-L${_oblas}/lib"
    export CPPFLAGS="-I${_oblas}/include"
    export PKG_CONFIG_PATH="${_oblas}/lib/pkgconfig"
    export CMAKE_PREFIX_PATH="${_oblas}"
  fi
  unset _oblas
fi
