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
| `jj/` | `~/.config/jj/config.toml` |
| `claude/` | `~/.claude/` |
| `opencode/` | `~/.config/opencode/` |
| `codex/` | `~/.codex/` |
| `pi/` | `~/.pi/` |

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
| `scripts/bootstrap-dirs.sh` | Create directories, sync shared skills, and materialize default configs |
| `scripts/sync-agent-rules.sh` | Sync `shared/AGENTS.md` and MCP servers to Claude Code, Codex, OpenCode |
| `scripts/agent-workflow` | Attach/detach/status/doctor for per-repo Commandr/Pi/Neovim workflow |
| `scripts/agent-session` | Legacy per-repo session inbox used during migration to the Pi + AgentOps session API |

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
| `rtk` (Rust Token Killer) | `brew install rtk` (included in `Brewfile`) |

`omp` binaries land in `~/.bun/bin/` — already on PATH via `.zprofile`.

The `pi/` stow package includes these Pi extensions:

- `neovim-cockpit.ts` — `/cockpit`, `/nvim-context`, `/nvim-refresh`,
  `nvim_context` tool, `#TASK` autocomplete
- `pi-statusline.ts` — Catppuccin footer statusline (dir, git, ctx%, model)
  with Nerd Font icons
- `pi-session.ts` — `/save-session`, `/clear-context` (new session = 0%),
  `/sessions`, `/resume`, `/spec`, `/plan`, `/design`, `/arch`, `/pr`,
  `/review`, `/open`, `/diff` (red-for-deletions fix)
- `rtk.ts` — transparently rewrites supported Bash commands through RTK to
  reduce tool-output tokens; set `RTK_DISABLED=1` for passthrough

Claude Code uses the equivalent `rtk hook claude` `PreToolUse` hook from
`claude/.claude/settings.json`, with usage instructions in `~/.claude/RTK.md`.

### Research tool routing

Research tools have exclusive primary scopes:

- **Context7** — official library, framework, SDK, CLI, and API documentation
- **Ketch** — public implementation examples through `ketch code` only
- **Firecrawl** — general web search, URLs, news, crawling, and page extraction

Fallback is allowed only when the primary tool lacks coverage. Canonical policy
lives in `shared/research-tool-routing.md`; `bootstrap-dirs.sh` syncs the scoped
Firecrawl skill to `~/.agents/skills/firecrawl`.

### Agent workflow automation

Global defaults live in `shared/agent-workflow.default.json` and are copied to
`~/.config/agent-workflow/config.json` by `scripts/bootstrap-dirs.sh`. Override
per repo with `.agent-workflow.json` or machine-locally with ignored
`.agent-workflow.local.json`.

```sh
# Check global install state (including RTK binary + Pi extension)
scripts/agent-workflow doctor

# Attach a repo to the Commandr bus + DiffViewer sidecars + approval gate
scripts/agent-workflow attach ~/repos/example

# Inspect current bus/board state
scripts/agent-workflow status ~/repos/example

# Remove only the managed hook; keep task history by default
scripts/agent-workflow detach ~/repos/example
```

### Pi-first workflow

Pi is the only supported agent harness. AgentOps is the durable context plane,
Commandr is the task service, DiffView is the review service, and Obsidian is
the human UI. Other vendors are model providers or explicit CLI bridges, not
parallel harnesses.

```sh
# AgentOps-backed Pi workflow (target contract)
agentops context <work-item>
agentops session checkpoint
agentops spec create
agentops plan create
agentops review start

# Pi TUI
/clear-context
/sessions
/spec
/plan
/review
```

Legacy `scripts/agent-session` and `.agents/sessions/` remain compatibility
surfaces during migration. New workflow features should target AgentOps and
Pi, not add another harness-specific state store.

RTK is a rewrite-only optimization layer: it does not replace permission gates
or context-mode. Inspect savings with `rtk gain` or `rtk gain --history`.

## Notes

- `opencode/plugins/commandr-checkpoint.js` and `diffviewer.js` are symlinks into `~/repos/Commandr` and `~/repos/DiffViewer`. Clone those repos first.
- Machine-local overrides go in `~/.zshrc.local` (not tracked).
- `nvim/.config/nvim/.claude/` is gitignored — Claude Code writes local state there.
- `claude/` rule files: `learning.md` and `research.md` are niche-domain rules, available at `@~/.claude/rules/learning.md` but not auto-loaded. @-import them in project CLAUDE.md when working in those domains.
- `opencode/opencode.json` uses hardcoded absolute paths for `skills.paths` and `instructions` — opencode does not expand `${env:HOME}` in those fields.
- tmux `extended-keys` is disabled — it breaks readline Ctrl shortcuts (C-a/e/u/k/w/r/d) in zsh. Standard key sequences work correctly without it.
- `zsh/.zsh/functions.zsh` wraps `nvim` to re-emit SGR reset, show-cursor, and bracketed-paste sequences after exit — nvim's terminal cleanup (rs2/RIS) wipes these and breaks Starship colors and fast-syntax-highlighting.
- Language toolchains (Python, Node, Ruby) managed by **mise** — Ansible replaced pyenv/rbenv/nvm. Neovim detects interpreters dynamically via `vim.fn.exepath()`.
