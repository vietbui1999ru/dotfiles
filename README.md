# dotfiles

Personal dotfiles managed with [GNU Stow](https://www.gnu.org/software/stow/). Ansible handles provisioning on new machines.

**Theme:** Catppuccin Macchiato throughout.

## Packages

Provisioning uses three mechanisms — know which applies before editing a package:
**stow** (symlink, edits round-trip to git), **materialized** (copied once from a template by
`bootstrap-dirs.sh`, then drifts silently — edit the template, not the live file), and
**sync-pushed** (one-way push by `sync-agent-rules.sh`, live edits are invisible to git).

| Package | Stow target | Provisioning |
|---|---|---|
| `zsh/` | `~/.zshrc`, `~/.zprofile`, `~/.zsh/` | stow |
| `starship/` | `~/.config/starship.toml` | stow |
| `nvim/` | `~/.config/nvim/` | stow |
| `tmux/` | `~/.tmux.conf`, `~/.local/bin/tmux-cht` | stow |
| `kitty/` | `~/.config/kitty/` | stow |
| `git/` | `~/.gitconfig` | stow |
| `jj/` | `~/.config/jj/config.toml` | stow — **not currently applied on this machine** |
| `aerospace/` | `~/.aerospace.toml` | stow (macOS tiling WM) — not in the `stow` line above; add when used |
| `i3/` | `~/.config/i3/config` | Linux-only, applied via Ansible (not macOS stow) |
| `claude/` | `~/.claude/` | stow (partial) — files symlinked; `skills/`+`agents/` mix dotfiles and `llm-wiki` sources |
| `opencode/` | `~/.config/opencode/` | partial — `plugins/` stow; `opencode.json` materialized; `agents/`/`skills/` unmanaged |
| `codex/` | `~/.codex/` | **no-op stub today** — Codex is sync-pushed via `sync-agent-rules.sh`, not stowed |
| `pi/` | `~/.pi/` | stow (extensions only); `~/.pi/agent/` runtime state is unmanaged |

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
stow zsh starship nvim tmux kitty git jj claude opencode codex pi

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
| `scripts/bootstrap-dirs.sh` | Create `~/repos`, symlink `~/repos/llm-wiki` → submodule, materialize default configs |
| `scripts/sync-agent-rules.sh` | Sync `shared/AGENTS.md` and MCP servers to Claude Code, Codex, OpenCode |
| `scripts/agent-workflow` | Attach/detach/status/doctor for per-repo Commandr/Pi/Neovim workflow |
| `scripts/agent-session` | Universal per-repo session inbox: save/list/show/resume/active/idle/index/open across all harnesses |

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

The `pi/` stow package installs three Pi TUI extensions:

- `neovim-cockpit.ts` — `/cockpit`, `/nvim-context`, `/nvim-refresh`,
  `nvim_context` tool, `#TASK` autocomplete
- `pi-statusline.ts` — Catppuccin footer statusline (dir, git, ctx%, model)
  with Nerd Font icons
- `pi-session.ts` — `/save-session`, `/clear-context` (new session = 0%),
  `/sessions`, `/resume`, `/spec`, `/plan`, `/design`, `/arch`, `/pr`,
  `/review`, `/open`, `/diff` (red-for-deletions fix)

### Agent workflow automation

Global defaults live in `shared/agent-workflow.default.json` and are copied to
`~/.config/agent-workflow/config.json` by `scripts/bootstrap-dirs.sh`. Override
per repo with `.agent-workflow.json` or machine-locally with ignored
`.agent-workflow.local.json`.

```sh
# Check global install state
scripts/agent-workflow doctor

# Attach a repo to the Commandr bus + DiffViewer sidecars + approval gate
scripts/agent-workflow attach ~/repos/example

# Inspect current bus/board state
scripts/agent-workflow status ~/repos/example

# Remove only the managed hook; keep task history by default
scripts/agent-workflow detach ~/repos/example
```

### Universal session inbox

All harnesses (Claude, Codex, OpenCode, Pi) save session state to
`.agents/sessions/` with harness + work-type tags:

```sh
# Save a session/spec/PR to the universal inbox
scripts/agent-session save --harness pi --kind spec --goal "feature X"

# List all sessions across all harnesses
scripts/agent-session list

# Get the latest active session (for injection on resume)
scripts/agent-session active

# Mark idle when work is complete
scripts/agent-session idle
```

SPEC/PR/design/architecture templates in `shared/templates/` follow the Addy
Osmani spec framework (6 core areas, 3-tier boundaries) and the undefeated PR
template (7 sections). Use `agent-session save --kind spec|pr|design|arch|plan`
to scaffold from templates.

In Pi TUI: `/clear-context` saves state then starts a fresh session (ctx → 0%),
`/spec`, `/pr`, etc. scaffold from templates, `/diff` renders diffs with
unambiguous red deletions.

## Notes

- `opencode/plugins/commandr-checkpoint.js` and `diffviewer.js` are symlinks into `~/repos/Commandr` and `~/repos/DiffViewer`. Clone those repos first.
- Machine-local overrides go in `~/.zshrc.local` (not tracked).
- `nvim/.config/nvim/.claude/` is gitignored — Claude Code writes local state there.
- `claude/` rule files: `learning.md` and `research.md` are niche-domain rules, available at `@~/.claude/rules/learning.md` but not auto-loaded. @-import them in project CLAUDE.md when working in those domains.
- `opencode/opencode.json` uses hardcoded absolute paths for `skills.paths` and `instructions` — opencode does not expand `${env:HOME}` in those fields.
- tmux `extended-keys` is disabled — it breaks readline Ctrl shortcuts (C-a/e/u/k/w/r/d) in zsh. Standard key sequences work correctly without it.
- `zsh/.zsh/functions.zsh` wraps `nvim` to re-emit SGR reset, show-cursor, and bracketed-paste sequences after exit — nvim's terminal cleanup (rs2/RIS) wipes these and breaks Starship colors and fast-syntax-highlighting.
- Language toolchains (Python, Node, Ruby) managed by **mise** — Ansible replaced pyenv/rbenv/nvm. Neovim detects interpreters dynamically via `vim.fn.exepath()`.
