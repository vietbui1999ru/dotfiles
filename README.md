# dotfiles

Personal dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/). Ansible handles provisioning on new machines.

**Theme:** Catppuccin Macchiato throughout.

## Packages

| Package | Stow target |
|---|---|
| `zsh/` | `~/.zshrc`, `~/.zprofile`, `~/.zsh/` |
| `starship/` | `~/.config/starship.toml` |
| `nvim/` | `~/.config/nvim/` |
| `tmux/` | `~/.config/tmux/` |
| `kitty/` | `~/.config/kitty/` |
| `git/` | `~/.gitconfig` |
| `claude/` | `~/.claude/` |
| `opencode/` | `~/.config/opencode/` |
| `codex/` | `~/.codex/` |

## Quick start (macOS)

```sh
# 1. Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Install packages
brew bundle

# 3. Create expected directories
./scripts/bootstrap-dirs.sh

# 4. Symlink configs
stow zsh starship nvim tmux kitty git claude opencode codex

# 5. Sync AI tool rules (AGENTS.md + MCP servers)
./scripts/sync-agent-rules.sh
```

## Ansible (Linux / new machine)

Covers: base packages, Rust toolchain, modern CLI tools, zsh, starship, tmux, neovim. Kitty only on macOS/desktop.

```sh
# Local machine
ansible-playbook ansible/site.yml --limit localhost

# Remote Debian dev server
ansible-playbook ansible/site.yml --limit dev_debian -i ansible/inventory/hosts

# Remote RedHat admin server
ansible-playbook ansible/site.yml --limit admin_redhat -i ansible/inventory/hosts
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/bootstrap-dirs.sh` | Create `~/repos` and note symlink dependencies |
| `scripts/sync-agent-rules.sh` | Sync `shared/AGENTS.md` and MCP servers to Claude Code, Codex, OpenCode |

## Notes

- `opencode/plugins/commandr-checkpoint.js` and `diffviewer.js` are symlinks into `~/repos/Commandr` and `~/repos/DiffViewer`. Clone those repos first.
- Machine-local overrides go in `~/.zshrc.local` (not tracked).
- `nvim/.config/nvim/.claude/` is gitignored — Claude Code writes local state there.
