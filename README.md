# dotfiles

Personal dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/). Ansible handles provisioning on new machines.

**Theme:** Catppuccin Macchiato throughout.

## Packages

| Package | Stow target |
|---|---|
| `zsh/` | `~/.zshrc`, `~/.zprofile`, `~/.zsh/` |
| `starship/` | `~/.config/starship.toml` |
| `nvim/` | `~/.config/nvim/` |
| `tmux/` | `~/.tmux.conf`, `~/.local/bin/tmux-cht` |
| `kitty/` | `~/.config/kitty/` |
| `git/` | `~/.gitconfig` |
| `claude/` | `~/.claude/` |
| `opencode/` | `~/.config/opencode/` |
| `codex/` | `~/.codex/` |

## Quick start (macOS)

```sh
# 1. Clone (submodules required — llm-wiki is bundled as a submodule)
git clone --recurse-submodules git@github.com:vietbui99/dotfiles.git ~/dotfiles

# 2. Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 3. Install packages
cd ~/dotfiles && brew bundle

# 4. Create expected directories and ~/repos/llm-wiki symlink
./scripts/bootstrap-dirs.sh

# 5. Symlink configs
stow zsh starship nvim tmux kitty git claude opencode codex

# 6. Sync AI tool rules (AGENTS.md + MCP servers)
./scripts/sync-agent-rules.sh
```

## Ansible (Linux / new machine)

Covers: base packages, Rust toolchain, modern CLI tools, zsh, starship, tmux, neovim. Kitty only on macOS/desktop.

```sh
# Local machine
ansible-playbook ansible/site.yml --limit localhost

# Remote Debian dev server
ansible-playbook ansible/site.yml --limit dev_debian -i ansible/inventory/hosts.yml

# Remote RedHat admin server
ansible-playbook ansible/site.yml --limit admin_redhat -i ansible/inventory/hosts.yml
```

## Scripts

| Script | Purpose |
|---|---|
| `scripts/bootstrap-dirs.sh` | Create `~/repos`, symlink `~/repos/llm-wiki` → submodule |
| `scripts/sync-agent-rules.sh` | Sync `shared/AGENTS.md` and MCP servers to Claude Code, Codex, OpenCode |

## Submodules

`repos/llm-wiki` is a git submodule — the shared upstream for Claude Code agents, skills, and rules.

```sh
# Update llm-wiki pin to latest upstream commit
git submodule update --remote repos/llm-wiki
git add repos/llm-wiki && git commit -m "chore(submodule): bump llm-wiki"
```

`bootstrap-dirs.sh` creates `~/repos/llm-wiki` as a symlink → the submodule, so existing paths in `~/.claude/` resolve correctly without changing any symlinks.

## AI Agents

| Tool | Install |
|---|---|
| `pi` (pi-coding-agent) | `npm install -g @earendil-works/pi-coding-agent` |
| `omp` (oh-my-pi) | `curl -fsSL https://omp.sh/install \| sh` |

`omp` binaries land in `~/.bun/bin/` — already on PATH via `.zprofile`.

## Notes

- `opencode/plugins/commandr-checkpoint.js` and `diffviewer.js` are symlinks into `~/repos/Commandr` and `~/repos/DiffViewer`. Clone those repos first.
- Machine-local overrides go in `~/.zshrc.local` (not tracked).
- `nvim/.config/nvim/.claude/` is gitignored — Claude Code writes local state there.
- `claude/` rule files: `learning.md` and `research.md` are niche-domain rules, available at `@~/.claude/rules/learning.md` but not auto-loaded. @-import them in project CLAUDE.md when working in those domains.
- `opencode/opencode.json` uses hardcoded absolute paths for `skills.paths` and `instructions` — opencode does not expand `${env:HOME}` in those fields.
- tmux `extended-keys` is disabled — it breaks readline Ctrl shortcuts (C-a/e/u/k/w/r/d) in zsh. Standard key sequences work correctly without it.
- `zsh/.zsh/functions.zsh` wraps `nvim` to re-emit SGR reset, show-cursor, and bracketed-paste sequences after exit — nvim's terminal cleanup (rs2/RIS) wipes these and breaks Starship colors and fast-syntax-highlighting.
- Language toolchains (Python, Node, Ruby) managed by **mise** — Ansible replaced pyenv/rbenv/nvm. Neovim detects interpreters dynamically via `vim.fn.exepath()`.
