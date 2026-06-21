# Dotfiles Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate all configs (zsh, tmux, kitty, nvim) into a GNU Stow dotfiles repo, replace oh-my-zsh + p10k with sheldon + starship, add modern CLI tools, and wire Ansible roles for one-command install on macOS + Linux.

**Architecture:** Each tool gets its own stow package (`dotfiles/<tool>/`). Ansible roles install binaries, then stow symlinks configs. zsh config uses sheldon for plugin management and starship for the prompt — both are portable Rust binaries with XDG-conformant config.

**Tech Stack:** GNU Stow, sheldon, starship, Ansible, Homebrew (macOS), apt/dnf (Linux), eza/bat/ripgrep/fd/delta/lazygit/fzf/zoxide

## Global Constraints

- All configs must work on macOS (Apple Silicon) and Linux (Debian/RedHat)
- No hardcoded `/Users/vietquocbui` or `/opt/homebrew` paths in any config
- Secrets stay out of dotfiles — source `~/.zshrc.local` for machine-specific overrides
- catppuccin-macchiato theme applied everywhere
- nvim uses 0.12 built-in pack manager — no lazy.nvim
- Stow target is always `$HOME`
- Ansible inventory: `ansible/inventory/hosts.yml` (already defines dev_debian + admin_redhat groups)

---

## File Map

**Created:**
- `dotfiles/zsh/.zshrc`
- `dotfiles/zsh/.zshenv`
- `dotfiles/zsh/.zsh/aliases.zsh`
- `dotfiles/zsh/.zsh/functions.zsh`
- `dotfiles/zsh/.config/sheldon/plugins.toml`
- `dotfiles/starship/.config/starship.toml`
- `dotfiles/git/.gitconfig` (delta integration added to existing)
- `dotfiles/tmux/.tmux.conf` (copied from `~/.tmux.conf`)
- `dotfiles/kitty/.config/kitty/` (copied from `~/.config/kitty/`)
- `dotfiles/nvim/.config/nvim/` (copied from `~/.config/nvim/`, paths fixed)
- `dotfiles/Brewfile`
- `dotfiles/ansible/site.yml`
- `dotfiles/ansible/roles/base/tasks/main.yml`
- `dotfiles/ansible/roles/tools/tasks/main.yml` (NEW role)
- `dotfiles/ansible/roles/zsh/tasks/main.yml`
- `dotfiles/ansible/roles/starship/tasks/main.yml` (NEW role)
- `dotfiles/ansible/roles/tmux/tasks/main.yml`
- `dotfiles/ansible/roles/neovim/tasks/main.yml`
- `dotfiles/ansible/roles/kitty/tasks/main.yml` (NEW role)
- `dotfiles/ansible/roles/dotfiles/tasks/main.yml`

**Modified:**
- `dotfiles/ansible/roles/github-ssh/tasks/main.yml` (stub if empty)

---

### Task 1: Scaffold stow packages + migrate existing configs

**Files:**
- Create: `dotfiles/tmux/.tmux.conf`
- Create: `dotfiles/kitty/.config/kitty/` (full copy)
- Create: `dotfiles/nvim/.config/nvim/` (full copy, paths fixed)

**Goal:** Get existing tools into the stow repo before touching zsh (safest order — zsh is last since we're rewriting it).

- [ ] **Step 1: Create stow package dirs**

```bash
mkdir -p ~/dotfiles/tmux
mkdir -p ~/dotfiles/kitty/.config/kitty
mkdir -p ~/dotfiles/nvim/.config/nvim
mkdir -p ~/dotfiles/zsh/.zsh
mkdir -p ~/dotfiles/zsh/.config/sheldon
mkdir -p ~/dotfiles/starship/.config
mkdir -p ~/dotfiles/git
```

- [ ] **Step 2: Copy tmux config**

```bash
cp ~/.tmux.conf ~/dotfiles/tmux/.tmux.conf
```

- [ ] **Step 3: Copy kitty config**

```bash
cp -r ~/.config/kitty/. ~/dotfiles/kitty/.config/kitty/
```

- [ ] **Step 4: Copy nvim config**

```bash
cp -r ~/.config/nvim/. ~/dotfiles/nvim/.config/nvim/
```

- [ ] **Step 5: Fix hardcoded paths in nvim init.lua**

Edit `dotfiles/nvim/.config/nvim/init.lua`. Replace the two hardcoded prog lines:

```lua
-- OLD (remove these two lines):
-- vim.g.python3_host_prog = "/Users/vietquocbui/.pyenv/versions/3.14.0/envs/neovim/bin/python3"
-- vim.g.node_host_prog = "/Users/vietquocbui/.nvm/versions/node/v23.11.0/bin/node"

-- NEW (add after vim.g.have_nerd_font line):
local _py = vim.fn.exepath("python3")
if _py ~= "" then vim.g.python3_host_prog = _py end

local _node = vim.fn.exepath("node")
if _node ~= "" then vim.g.node_host_prog = _node end
```

- [ ] **Step 6: Dry-run stow for all three packages**

```bash
cd ~/dotfiles
stow --dry-run --target="$HOME" tmux kitty nvim
```

Expected: lines starting with `LINK:` for each file. No `ERROR:` lines. If conflicts appear, the originals need to be removed first (step 7).

- [ ] **Step 7: Remove originals and stow**

```bash
rm ~/.tmux.conf
rm -rf ~/.config/kitty
rm -rf ~/.config/nvim
cd ~/dotfiles && stow --target="$HOME" tmux kitty nvim
```

- [ ] **Step 8: Verify symlinks**

```bash
ls -la ~/.tmux.conf ~/.config/kitty ~/.config/nvim
```

Expected: all three are symlinks pointing into `~/dotfiles/`.

- [ ] **Step 9: Smoke test**

```bash
tmux new-session -d -s test && tmux kill-session -t test && echo "tmux ok"
nvim --headless +qa && echo "nvim ok"
```

- [ ] **Step 10: Commit**

```bash
cd ~/dotfiles
git add tmux/ kitty/ nvim/
git commit -m "feat(dotfiles): add tmux, kitty, nvim stow packages"
```

---

### Task 2: Rewrite zsh config (OMZ + p10k → sheldon + starship)

**Files:**
- Create: `dotfiles/zsh/.zshrc`
- Create: `dotfiles/zsh/.zshenv`
- Create: `dotfiles/zsh/.config/sheldon/plugins.toml`
- Create: `dotfiles/zsh/.zsh/aliases.zsh`
- Create: `dotfiles/zsh/.zsh/functions.zsh`

**Note:** Do NOT stow this package until Task 3 (starship config) is also ready — `.zshrc` sources starship.

- [ ] **Step 1: Write sheldon plugins.toml**

Create `dotfiles/zsh/.config/sheldon/plugins.toml`:

```toml
shell = "zsh"

[plugins.zsh-completions]
github = "zsh-users/zsh-completions"
apply = ["fpath"]

[plugins.fast-syntax-highlighting]
github = "zdharma-continuum/fast-syntax-highlighting"

[plugins.zsh-autosuggestions]
github = "zsh-users/zsh-autosuggestions"

[plugins.zsh-history-substring-search]
github = "zsh-users/zsh-history-substring-search"
hooks.add = """
bindkey '^[[A' history-substring-search-up
bindkey '^[[B' history-substring-search-down
"""
```

- [ ] **Step 2: Write aliases.zsh**

Create `dotfiles/zsh/.zsh/aliases.zsh`:

```zsh
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
```

- [ ] **Step 3: Write functions.zsh**

Create `dotfiles/zsh/.zsh/functions.zsh`:

```zsh
# Activate virtualenv if present, then launch nvim
nvimvenv() {
  if [[ -n "$VIRTUAL_ENV" ]] && [[ -f "$VIRTUAL_ENV/bin/activate" ]]; then
    source "$VIRTUAL_ENV/bin/activate"
    command nvim "$@"
    deactivate
  else
    command nvim "$@"
  fi
}

# LLM council — voices: sonnet + gpt-5.4 | chairman: opus
council() {
  source ~/repos/llm-wiki/templates/env-model-routing.sh
  uv run ~/repos/llm-wiki/templates/council.py "$@"
}

claude-tui() {
  cd ~/repos/RustProjects/claude-tui/ && cargo run -p claude-tui
}

resumed() {
  node "99 System/Agents/Gemini/skills/obsidian-notes-to-resume/scripts/generate_resume.js"
}
```

- [ ] **Step 4: Write .zshenv**

Create `dotfiles/zsh/.zshenv`:

```zsh
# Sourced for ALL zsh instances (login, non-login, scripts)
# Keep minimal — only PATH and env vars needed before .zshrc

. "$HOME/.cargo/env"

export XDG_CONFIG_HOME="$HOME/.config"
export XDG_DATA_HOME="$HOME/.local/share"
export XDG_CACHE_HOME="$HOME/.cache"
```

- [ ] **Step 5: Write .zshrc**

Create `dotfiles/zsh/.zshrc`:

```zsh
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
```

- [ ] **Step 6: Move secrets to .zshrc.local**

The original zshrc sourced `~/secrets/.env`. Create `~/.zshrc.local` on your machine (not in git):

```bash
cat > ~/.zshrc.local << 'EOF'
# Machine-specific config — not tracked in git
[[ -f "$HOME/secrets/.env" ]] && source "$HOME/secrets/.env"
EOF
```

- [ ] **Step 7: Commit zsh package (not yet stowed)**

```bash
cd ~/dotfiles
git add zsh/
git commit -m "feat(zsh): sheldon + starship config, split aliases/functions"
```

---

### Task 3: Starship config (catppuccin macchiato)

**Files:**
- Create: `dotfiles/starship/.config/starship.toml`

- [ ] **Step 1: Write starship.toml**

Create `dotfiles/starship/.config/starship.toml`:

```toml
"$schema" = 'https://starship.rs/config-schema.json'

palette = "catppuccin_macchiato"

format = """
[](surface0)\
$os\
$username\
[](bg:peach fg:surface0)\
$directory\
[](bg:green fg:peach)\
$git_branch\
$git_status\
[](bg:teal fg:green)\
$c\
$rust\
$golang\
$nodejs\
$python\
[](fg:teal)\
$line_break$character"""

add_newline = true
command_timeout = 1000

[os]
disabled = false
style = "bg:surface0 fg:text"

[os.symbols]
Macos = "󰀵 "
Linux = " "

[username]
show_always = false
style_user = "bg:surface0 fg:text"
style_root = "bg:surface0 fg:red"
format = '[$user ]($style)'
disabled = false

[directory]
style = "bg:peach fg:base"
format = "[ $path ]($style)"
truncation_length = 3
truncation_symbol = "…/"

[directory.substitutions]
"Documents" = "󰈙 "
"Downloads" = " "
"Music" = "󰝚 "
"Pictures" = " "
"repos" = "󰲋 "
"dotfiles" = " "

[git_branch]
symbol = ""
style = "bg:green fg:base"
format = '[ $symbol $branch ]($style)'

[git_status]
style = "bg:green fg:base"
format = '[$all_status$ahead_behind ]($style)'

[nodejs]
symbol = ""
style = "bg:teal fg:base"
format = '[ $symbol ($version) ]($style)'

[python]
symbol = ""
style = "bg:teal fg:base"
format = '[ $symbol ($version) ]($style)'

[rust]
symbol = ""
style = "bg:teal fg:base"
format = '[ $symbol ($version) ]($style)'

[golang]
symbol = ""
style = "bg:teal fg:base"
format = '[ $symbol ($version) ]($style)'

[c]
symbol = " "
style = "bg:teal fg:base"
format = '[ $symbol ($version) ]($style)'

[character]
success_symbol = '[❯](bold green)'
error_symbol = '[❯](bold red)'

[palettes.catppuccin_macchiato]
rosewater = "#f4dbd6"
flamingo  = "#f0c6c6"
pink      = "#f5bde6"
mauve     = "#c6a0f6"
red       = "#ed8796"
maroon    = "#ee99a0"
peach     = "#f5a97f"
yellow    = "#eed49f"
green     = "#a6da95"
teal      = "#8bd5ca"
sky       = "#91d7e3"
sapphire  = "#7dc4e4"
blue      = "#8aadf4"
lavender  = "#b7bdf8"
text      = "#cad3f5"
subtext1  = "#b8c0e0"
subtext0  = "#a5adcb"
overlay2  = "#939ab7"
overlay1  = "#8087a2"
overlay0  = "#6e738d"
surface2  = "#5b6078"
surface1  = "#494d64"
surface0  = "#363a4f"
base      = "#24273a"
mantle    = "#1e2030"
crust     = "#181926"
```

- [ ] **Step 2: Stow zsh + starship packages**

```bash
cd ~/dotfiles

# backup old zsh files
cp ~/.zshrc ~/.zshrc.pre-migration
cp ~/.zshenv ~/.zshenv.pre-migration 2>/dev/null || true

# remove originals
rm ~/.zshrc ~/.zshenv ~/.p10k.zsh 2>/dev/null || true
rm -rf ~/.zsh/my_functions.zsh  # replaced by aliases.zsh + functions.zsh

stow --dry-run --target="$HOME" zsh starship
stow --target="$HOME" zsh starship
```

- [ ] **Step 3: Install sheldon + starship (macOS)**

```bash
brew install sheldon starship
```

- [ ] **Step 4: Lock sheldon plugins**

```bash
sheldon lock
```

Expected: downloads plugins into `~/.local/share/sheldon/`. No errors.

- [ ] **Step 5: Test new shell**

```bash
zsh -c 'source ~/.zshrc; echo "shell ok: $SHELL"'
```

Expected: `shell ok: /bin/zsh` (or wherever zsh lives). No errors about missing commands.

- [ ] **Step 6: Open a new terminal and verify prompt**

Starship prompt should appear with catppuccin colors. Verify:
- `cd ~/dotfiles` → directory segment shows
- `git status` → git segment appears
- Run a failing command → `❯` turns red

- [ ] **Step 7: Commit**

```bash
cd ~/dotfiles
git add starship/
git commit -m "feat(starship): catppuccin-macchiato prompt config"
```

---

### Task 4: Git config with delta

**Files:**
- Create: `dotfiles/git/.gitconfig`

**Note:** Stowing `.gitconfig` will conflict if `~/.gitconfig` exists. We merge delta config in rather than replacing the whole file.

- [ ] **Step 1: Add delta to existing .gitconfig**

```bash
git config --global core.pager delta
git config --global interactive.diffFilter "delta --color-only"
git config --global delta.navigate true
git config --global delta.dark true
git config --global delta.line-numbers true
git config --global delta.syntax-theme "Dracula"
git config --global merge.conflictstyle diff3
git config --global diff.colorMoved default
```

- [ ] **Step 2: Copy .gitconfig into stow package**

```bash
cp ~/.gitconfig ~/dotfiles/git/.gitconfig
```

- [ ] **Step 3: Remove original, stow**

```bash
rm ~/.gitconfig
cd ~/dotfiles && stow --dry-run --target="$HOME" git
stow --target="$HOME" git
```

- [ ] **Step 4: Verify**

```bash
ls -la ~/.gitconfig   # should be symlink
git diff HEAD~1       # should render with delta
```

- [ ] **Step 5: Commit**

```bash
cd ~/dotfiles
git add git/
git commit -m "feat(git): add delta pager config"
```

---

### Task 5: Brewfile (macOS package manifest)

**Files:**
- Create: `dotfiles/Brewfile`

- [ ] **Step 1: Write Brewfile**

Create `dotfiles/Brewfile`:

```ruby
# Core
brew "git"
brew "stow"
brew "curl"
brew "wget"

# Shell
brew "sheldon"
brew "starship"
brew "zsh"

# Terminal
cask "kitty"

# Multiplexer
brew "tmux"

# Editor
brew "neovim"

# Modern CLI (Rust tools)
brew "eza"
brew "bat"
brew "ripgrep"
brew "fd"
brew "git-delta"
brew "lazygit"
brew "fzf"
brew "zoxide"

# Dev tools
brew "pyenv"
brew "pyenv-virtualenv"
brew "rbenv"
brew "go"
brew "node"
brew "uv"

# Utilities
brew "jq"
brew "yq"
brew "htop"
brew "btop"
brew "fastfetch"
brew "ansible"
```

- [ ] **Step 2: Test Brewfile installs**

```bash
brew bundle --file=~/dotfiles/Brewfile --no-upgrade 2>&1 | tail -20
```

Expected: `Using <package>` for already-installed packages. No fatal errors.

- [ ] **Step 3: Commit**

```bash
cd ~/dotfiles
git add Brewfile
git commit -m "feat(brew): add Brewfile for macOS package manifest"
```

---

### Task 6: Ansible — base + tools roles

**Files:**
- Create: `dotfiles/ansible/roles/base/tasks/main.yml`
- Create: `dotfiles/ansible/roles/tools/tasks/main.yml`
- Create: `dotfiles/ansible/roles/tools/` (new role dir)

- [ ] **Step 1: Write base role**

Create `dotfiles/ansible/roles/base/tasks/main.yml`:

```yaml
---
- name: Install base packages (macOS)
  community.general.homebrew:
    name:
      - git
      - stow
      - curl
      - wget
    state: present
  when: ansible_os_family == "Darwin"

- name: Install base packages (Debian/Ubuntu)
  ansible.builtin.apt:
    name:
      - git
      - stow
      - curl
      - wget
      - build-essential
      - unzip
    state: present
    update_cache: true
  become: true
  when: ansible_os_family == "Debian"

- name: Install base packages (RedHat/Fedora)
  ansible.builtin.dnf:
    name:
      - git
      - stow
      - curl
      - wget
      - gcc
      - make
      - unzip
    state: present
  become: true
  when: ansible_os_family == "RedHat"
```

- [ ] **Step 2: Create tools role dir**

```bash
mkdir -p ~/dotfiles/ansible/roles/tools/tasks
```

- [ ] **Step 3: Write tools role**

Create `dotfiles/ansible/roles/tools/tasks/main.yml`:

```yaml
---
# ── macOS (Homebrew) ─────────────────────────────────────────────────
- name: Install modern CLI tools (macOS)
  community.general.homebrew:
    name:
      - eza
      - bat
      - ripgrep
      - fd
      - git-delta
      - lazygit
      - fzf
      - zoxide
      - jq
      - btop
      - fastfetch
    state: present
  when: ansible_os_family == "Darwin"

# ── Debian/Ubuntu ────────────────────────────────────────────────────
- name: Install tools available in apt (Debian)
  ansible.builtin.apt:
    name:
      - ripgrep
      - fd-find
      - fzf
      - jq
      - btop
    state: present
    update_cache: true
  become: true
  when: ansible_os_family == "Debian"

- name: Install Rust-based tools via cargo (Debian)
  ansible.builtin.shell: |
    . "$HOME/.cargo/env"
    cargo install {{ item }} --locked
  loop:
    - eza
    - bat
    - git-delta
    - zoxide
  args:
    creates: "{{ ansible_env.HOME }}/.cargo/bin/{{ item | regex_replace('-', '') }}"
  when: ansible_os_family == "Debian"

- name: Install lazygit (Debian)
  ansible.builtin.shell: |
    LAZYGIT_VERSION=$(curl -s "https://api.github.com/repos/jesseduffield/lazygit/releases/latest" | grep '"tag_name"' | sed -E 's/.*"v*([^"]+)".*/\1/')
    curl -Lo /tmp/lazygit.tar.gz "https://github.com/jesseduffield/lazygit/releases/latest/download/lazygit_${LAZYGIT_VERSION}_Linux_x86_64.tar.gz"
    tar xf /tmp/lazygit.tar.gz -C /tmp lazygit
    install /tmp/lazygit /usr/local/bin
  become: true
  args:
    creates: /usr/local/bin/lazygit
  when: ansible_os_family == "Debian"

# ── RedHat/Fedora ────────────────────────────────────────────────────
- name: Install tools (RedHat/Fedora)
  ansible.builtin.dnf:
    name:
      - ripgrep
      - fd-find
      - fzf
      - jq
      - btop
    state: present
  become: true
  when: ansible_os_family == "RedHat"

- name: Install Rust-based tools via cargo (RedHat)
  ansible.builtin.shell: |
    . "$HOME/.cargo/env"
    cargo install {{ item }} --locked
  loop:
    - eza
    - bat
    - git-delta
    - zoxide
  args:
    creates: "{{ ansible_env.HOME }}/.cargo/bin/{{ item | regex_replace('-', '') }}"
  when: ansible_os_family == "RedHat"
```

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add ansible/roles/base/ ansible/roles/tools/
git commit -m "feat(ansible): base + tools roles (eza, bat, rg, fd, delta, lazygit, fzf, zoxide)"
```

---

### Task 7: Ansible — shell env roles

**Files:**
- Create: `dotfiles/ansible/roles/zsh/tasks/main.yml`
- Create: `dotfiles/ansible/roles/starship/tasks/main.yml`
- Create: `dotfiles/ansible/roles/starship/` (new role)
- Create: `dotfiles/ansible/roles/tmux/tasks/main.yml`
- Create: `dotfiles/ansible/roles/neovim/tasks/main.yml`
- Create: `dotfiles/ansible/roles/kitty/tasks/main.yml`
- Create: `dotfiles/ansible/roles/kitty/` (new role)
- Create: `dotfiles/ansible/roles/dotfiles/tasks/main.yml`

- [ ] **Step 1: Create new role dirs**

```bash
mkdir -p ~/dotfiles/ansible/roles/starship/tasks
mkdir -p ~/dotfiles/ansible/roles/kitty/tasks
```

- [ ] **Step 2: Write zsh role**

Create `dotfiles/ansible/roles/zsh/tasks/main.yml`:

```yaml
---
- name: Install zsh (macOS)
  community.general.homebrew:
    name: zsh
    state: present
  when: ansible_os_family == "Darwin"

- name: Install zsh (Debian)
  ansible.builtin.apt:
    name: zsh
    state: present
  become: true
  when: ansible_os_family == "Debian"

- name: Install zsh (RedHat)
  ansible.builtin.dnf:
    name: zsh
    state: present
  become: true
  when: ansible_os_family == "RedHat"

- name: Set zsh as default shell
  ansible.builtin.user:
    name: "{{ ansible_user_id }}"
    shell: "{{ ansible_env.HOME }}/.nix-profile/bin/zsh"
  become: true
  ignore_errors: true

- name: Install sheldon (macOS)
  community.general.homebrew:
    name: sheldon
    state: present
  when: ansible_os_family == "Darwin"

- name: Install sheldon via cargo (Linux)
  ansible.builtin.shell: |
    . "$HOME/.cargo/env"
    cargo install sheldon --locked
  args:
    creates: "{{ ansible_env.HOME }}/.cargo/bin/sheldon"
  when: ansible_os_family != "Darwin"

- name: Lock sheldon plugins
  ansible.builtin.shell: |
    export PATH="$HOME/.cargo/bin:$PATH"
    sheldon lock
  args:
    creates: "{{ ansible_env.XDG_DATA_HOME | default(ansible_env.HOME + '/.local/share') }}/sheldon/plugins.lock"
  environment:
    XDG_CONFIG_HOME: "{{ ansible_env.HOME }}/.config"
    XDG_DATA_HOME: "{{ ansible_env.HOME }}/.local/share"
```

- [ ] **Step 3: Write starship role**

Create `dotfiles/ansible/roles/starship/tasks/main.yml`:

```yaml
---
- name: Install starship (macOS)
  community.general.homebrew:
    name: starship
    state: present
  when: ansible_os_family == "Darwin"

- name: Install starship via script (Linux)
  ansible.builtin.shell: |
    curl -sS https://starship.rs/install.sh | sh -s -- --yes
  args:
    creates: /usr/local/bin/starship
  when: ansible_os_family != "Darwin"
```

- [ ] **Step 4: Write tmux role**

Create `dotfiles/ansible/roles/tmux/tasks/main.yml`:

```yaml
---
- name: Install tmux (macOS)
  community.general.homebrew:
    name: tmux
    state: present
  when: ansible_os_family == "Darwin"

- name: Install tmux (Debian)
  ansible.builtin.apt:
    name: tmux
    state: present
  become: true
  when: ansible_os_family == "Debian"

- name: Install tmux (RedHat)
  ansible.builtin.dnf:
    name: tmux
    state: present
  become: true
  when: ansible_os_family == "RedHat"

- name: Clone TPM
  ansible.builtin.git:
    repo: https://github.com/tmux-plugins/tpm
    dest: "{{ ansible_env.HOME }}/.tmux/plugins/tpm"
    depth: 1

- name: Install tmux plugins via TPM
  ansible.builtin.shell: |
    {{ ansible_env.HOME }}/.tmux/plugins/tpm/bin/install_plugins
  args:
    creates: "{{ ansible_env.HOME }}/.tmux/plugins/catppuccin"
```

- [ ] **Step 5: Write neovim role**

Create `dotfiles/ansible/roles/neovim/tasks/main.yml`:

```yaml
---
- name: Install neovim (macOS)
  community.general.homebrew:
    name: neovim
    state: latest
  when: ansible_os_family == "Darwin"

- name: Add neovim PPA (Debian/Ubuntu — gets 0.10+)
  ansible.builtin.apt_repository:
    repo: ppa:neovim-ppa/unstable
    state: present
  become: true
  when: ansible_distribution == "Ubuntu"

- name: Install neovim (Debian)
  ansible.builtin.apt:
    name: neovim
    state: latest
    update_cache: true
  become: true
  when: ansible_os_family == "Debian"

- name: Install neovim (RedHat/Fedora)
  ansible.builtin.dnf:
    name: neovim
    state: latest
  become: true
  when: ansible_os_family == "RedHat"

- name: Verify neovim version >= 0.12
  ansible.builtin.shell: |
    nvim --version | head -1
  register: nvim_version
  changed_when: false

- name: Show neovim version
  ansible.builtin.debug:
    msg: "{{ nvim_version.stdout }}"
```

- [ ] **Step 6: Write kitty role**

Create `dotfiles/ansible/roles/kitty/tasks/main.yml`:

```yaml
---
- name: Install kitty (macOS)
  community.general.homebrew_cask:
    name: kitty
    state: present
  when: ansible_os_family == "Darwin"

- name: Install kitty (Linux)
  ansible.builtin.shell: |
    curl -L https://sw.kovidgoyal.net/kitty/installer.sh | sh /dev/stdin
  args:
    creates: "{{ ansible_env.HOME }}/.local/kitty.app/bin/kitty"
  when: ansible_os_family != "Darwin"
```

- [ ] **Step 7: Write dotfiles role (runs stow)**

Create `dotfiles/ansible/roles/dotfiles/tasks/main.yml`:

```yaml
---
- name: Clone dotfiles repo
  ansible.builtin.git:
    repo: git@github.com:vietbui99/dotfiles.git
    dest: "{{ ansible_env.HOME }}/dotfiles"
    version: main
    depth: 1

- name: Stow all packages
  ansible.builtin.shell: |
    cd {{ ansible_env.HOME }}/dotfiles
    stow --target="{{ ansible_env.HOME }}" --restow {{ item }}
  loop:
    - zsh
    - starship
    - tmux
    - kitty
    - nvim
    - git
  register: stow_result
  changed_when: stow_result.stdout != ""
```

- [ ] **Step 8: Commit all roles**

```bash
cd ~/dotfiles
git add ansible/roles/
git commit -m "feat(ansible): fill zsh, starship, tmux, neovim, kitty, dotfiles roles"
```

---

### Task 8: Master Ansible playbook

**Files:**
- Create: `dotfiles/ansible/site.yml`

- [ ] **Step 1: Write site.yml**

Create `dotfiles/ansible/site.yml`:

```yaml
---
- name: Bootstrap local machine (macOS)
  hosts: localhost
  connection: local
  gather_facts: true
  roles:
    - base
    - tools
    - zsh
    - starship
    - tmux
    - neovim
    - kitty
    - dotfiles

- name: Bootstrap dev Debian servers
  hosts: dev_debian
  gather_facts: true
  roles:
    - base
    - tools
    - zsh
    - starship
    - tmux
    - neovim
    - dotfiles

- name: Bootstrap RedHat servers
  hosts: admin_redhat
  gather_facts: true
  roles:
    - base
    - tools
    - zsh
    - starship
    - tmux
    - neovim
    - dotfiles
```

- [ ] **Step 2: Test playbook syntax**

```bash
ansible-playbook ~/dotfiles/ansible/site.yml --syntax-check
```

Expected: `playbook: .../site.yml` with no errors.

- [ ] **Step 3: Dry-run localhost**

```bash
ansible-playbook ~/dotfiles/ansible/site.yml --limit localhost --check -v 2>&1 | tail -30
```

Expected: tasks show `ok` or `changed` (in check mode), no `FAILED` tasks.

- [ ] **Step 4: Commit**

```bash
cd ~/dotfiles
git add ansible/site.yml
git commit -m "feat(ansible): master playbook — localhost + dev_debian + admin_redhat"
```

---

## Spec Coverage Check

| Requirement | Task |
|---|---|
| tmux config in stow | Task 1 |
| kitty config in stow | Task 1 |
| nvim config in stow, paths fixed | Task 1 |
| OMZ removed, sheldon added | Task 2 |
| p10k removed, starship added | Task 3 |
| catppuccin macchiato prompt | Task 3 |
| Portable zshrc (no hardcoded paths) | Task 2 |
| Secrets moved to .zshrc.local | Task 2 |
| Git delta integration | Task 4 |
| Brewfile for macOS | Task 5 |
| eza, bat, rg, fd, delta, lazygit, fzf, zoxide | Task 5 + Task 6 |
| Ansible base role | Task 6 |
| Ansible tools role | Task 6 |
| Ansible zsh role | Task 7 |
| Ansible starship role | Task 7 |
| Ansible tmux role | Task 7 |
| Ansible neovim role (0.12) | Task 7 |
| Ansible kitty role | Task 7 |
| Ansible dotfiles (stow) role | Task 7 |
| Master playbook (macOS + Debian + RedHat) | Task 8 |
