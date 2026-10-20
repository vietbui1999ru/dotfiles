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
| `tmuxinator/` | `~/.config/tmuxinator/dotfiles.yml` | stow |
| `kitty/` | `~/.config/kitty/` | stow |
| `git/` | `~/.gitconfig` | stow |
| `jj/` | `~/.config/jj/config.toml` | stow — **not currently applied on this machine** |
| `aerospace/` | `~/.aerospace.toml` | stow (macOS tiling WM) — not in the `stow` line above; add when used |
| `mouseless/` | `~/Library/Application Support/Mouseless/configs/config.yaml` | stow (macOS Mouseless app) — not in the `stow` line above; back up the live file before first `stow mouseless`, restart the app after |
| `sketchybar/` | `~/.config/sketchybar/` | stow (macOS status bar) — not in the `stow` line above; add when used; `sketchybar --reload` after edits |
| `i3/` | `~/.config/i3/config` | Linux-only, applied via Ansible (not macOS stow) |
| `claude/` | `~/.claude/` | stow (partial) — including `settings.json`; `skills/`+`agents/` mix dotfiles and `llm-wiki` sources |
| `opencode/` | `~/.config/opencode/` | partial — `plugins/` stow; `opencode.json` materialized; `agents/`/`skills/` unmanaged |
| `codex/` | `~/.codex/` | **no-op stub today** — Codex is sync-pushed via `sync-agent-rules.sh`, not stowed |
| `pi/` | `~/.pi/` | stow (extensions only); `~/.pi/agent/` runtime state is unmanaged, except portable MCP entries sync-pushed to `mcp.json` |
| `herdr/` | `~/.config/herdr/config.toml` | stow — not in the `stow` line above; back up the live file before first `stow herdr`; `~/.config/herdr/` logs/sockets/session-history are unmanaged runtime state; `herdr server reload-config` after edits |
| `launchd/` | `~/Library/LaunchAgents/` | stow — user LaunchAgents such as the Herdr→Sketchybar bridge |

## Quick start (macOS)

```sh
# 1. Clone (submodules required — llm-wiki is bundled as a submodule)
git clone --recurse-submodules git@github.com:vietbui99/dotfiles.git ~/dotfiles

# 2. Install Homebrew
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 3. Install Homebrew packages (dev CLIs & runtimes are managed by mise — step 6)
cd ~/dotfiles && brew bundle

# 4. Create expected directories (uses a standalone ~/repos/llm-wiki clone if present)
./scripts/bootstrap-dirs.sh

# 5. Symlink configs (incl. mise/.config/mise/config.toml)
./scripts/restow.sh

# 6. Install dev CLIs & runtimes via mise
mise install

# 7. Sync AI tool rules (AGENTS.md + MCP servers)
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
| `scripts/restow.sh` | Restow all managed packages — single source of truth for the package list |
| `scripts/sync-agent-rules.sh` | Sync `shared/AGENTS.md` and MCP servers to Claude Code, Codex, OpenCode |
| `scripts/agent-workflow` | Attach/detach/status/doctor for per-repo Commandr/Pi/Neovim workflow |
| `scripts/agent-session` | Legacy per-repo session inbox kept for migration compatibility |

## Submodules

`repos/llm-wiki` is a git submodule — the shared upstream for Claude Code agents, skills, and rules.

```sh
# Update llm-wiki pin to latest upstream commit
git submodule update --remote repos/llm-wiki
git add repos/llm-wiki && git commit -m "chore(submodule): bump llm-wiki"

# After pulling a commit that moves the pin, check out the pinned commit
git submodule update --init repos/llm-wiki
```

`~/repos/llm-wiki` and `~/dotfiles/repos/llm-wiki` are independent clones on this machine. `bootstrap-dirs.sh` creates a redirect to the submodule only when no standalone clone exists; it never replaces an existing clone. Many Claude rules and skills are symlinks into the standalone clone (check with `readlink`); the spec-loop rules and skills, and the rules model-routing, plan-handoff, skill-invocation and startup, live in this repo. Commit and push wiki changes from the standalone clone first, then bump the pin here so the submodule matches its `main`.

## AI Agents

| Tool | Install |
|---|---|
| `pi` (pi-coding-agent) | `npm install -g @earendil-works/pi-coding-agent` |
| GitHub stacked PRs | `gh extension install github/gh-stack` (skill synced by `bootstrap-dirs.sh`) |
| `omp` (oh-my-pi) | `curl -fsSL https://omp.sh/install \| sh` |
| `rtk` (Rust Token Killer) | `mise install` (in `mise/.config/mise/config.toml`) |

`omp` binaries land in `~/.bun/bin/` — already on PATH via `.zprofile`.

The `pi/` stow package includes these Pi extensions:

- `pi-statusline.ts` — Catppuccin footer statusline (dir, git, ctx%, model)
  with Nerd Font icons
- `~/repos/DiffViewer/pi-extension` — Pi package for the measured review gate:
  persistent `.pi/diff-review/` drafts and submitted decisions
- `pi-side-panel/` — persistent tmux/herdr side panel (session, DiffViewer
  review, verification, Commandr, Neovim, git); `/panel` toggles
- `post-run-verifier.ts` — owns completed-run verification (format → lint →
  typecheck → focused tests), inferred per-project config persisted under
  `~/.pi/agent/verification/projects/`, max 3 automatic repair cycles;
  `/verify`, `/verify-final`, `/verify-status`, `/verify-config`, `/verify-init`.
- `rtk.ts` — transparently rewrites supported Bash commands through RTK to
  reduce tool-output tokens; set `RTK_DISABLED=1` for passthrough

`pi/.pi-lens/config.json` is the stow-provisioned global pi-lens config:
pi-lens owns non-mutating turn-end static safety/context signals; its LSP,
test, format, and autofix runners are disabled. `post-run-verifier.ts` alone
owns format, lint, typecheck, and focused behavioral tests.

Pi uses its built-in MCP client. `scripts/sync-agent-rules.sh` syncs the
portable servers in `shared/mcp-servers.json` into `~/.pi/agent/mcp.json`,
preserving machine-specific entries. Do not install `pi-mcp-adapter`.

### Intentional generated/config forks

- `shared/AGENTS.md` is one-way sync-pushed to OpenCode and Codex by
  `scripts/sync-agent-rules.sh`; edit the shared source, never the generated
  targets.
- `~/.claude/plugins/known_marketplaces.json` is materialized once from the
  llm-wiki template, then Claude Code manages it. Treat it as a deliberate
  local fork.
- `~/.config/agent-workflow/config.json` is materialized once from
  `shared/agent-workflow.default.json`. Treat it as a deliberate local fork;
  change the template for new machines and the local file for this machine.

Claude Code uses the equivalent `rtk hook claude` `PreToolUse` hook from
`claude/.claude/settings.json`, with usage instructions in `~/.claude/RTK.md`.

### Research tool routing

Research tools have exclusive primary scopes:

- **Context7** — official library, framework, SDK, CLI, and API documentation
- **Ketch** — public implementation examples through `ketch code` only
- **Firecrawl** — general web search, URLs, news, crawling, and page extraction

Fallback is allowed only when the primary tool lacks coverage. Canonical policy
lives in `shared/research-tool-routing.md`.

Firecrawl is CLI first, for every harness. `bootstrap-dirs.sh` calls
`scripts/firecrawl-setup.sh`, which links two shims into `~/.local/bin`
(`firecrawl` and `firecrawl-mcp`, both read `FIRECRAWL_API_KEY` from
`~/secrets/.env` so a stale inherited key cannot win), installs the CLI with npm if
it is missing, runs `firecrawl init` for the CLI's own skills, and keeps only the
ones listed in `shared/firecrawl-skills.txt`. The rest are moved to
`~/.agents/skills-disabled/`, not deleted. Add a name to that file and re-run
bootstrap to bring one back; `scripts/firecrawl-setup.sh --refresh` re-installs.
The same bootstrap links the shared personal skills (`gh-stack`, `grill-me`,
`verify-spec` and others) into `~/.agents/skills` for Pi and other compatible
harnesses. Codex needs a permission profile before its sandbox lets the
Firecrawl CLI reach the network: see `docs/codex-permissions.md`.

### Herdr agent flow

Herdr owns the live `pi`, `claude`, and `codex` integration files; do **not**
stow them. `scripts/bootstrap-dirs.sh` runs `herdr integration install` for
all three. The persistent Herdr workspaces are `plan` (Claude) and `build`
(Pi). `com.vietbui.herdr-sketchybar-bridge` subscribes to Herdr agent-state
events and drives Sketchybar's `agents` pill; clicking it focuses Pi and opens
AeroSpace workspace `T`.

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

### Spec loop

The spec loop is the six numbered rules between the `<!-- spec-loop:start -->` and `<!-- spec-loop:end -->` markers in `shared/AGENTS.md`. The same block is mirrored in `shared/research-tool-routing.md`; the two copies must stay identical. The rules themselves are canonical in that block; this section describes the workflow they govern.

Prerequisites: `python3` and `git`; approval also needs a macOS GUI session. The scripts are not on PATH, so call them as `~/dotfiles/scripts/ac-run` and `~/dotfiles/scripts/floor-guard`. Those paths point at the primary checkout, which may be on another branch; when developing the scripts in a feature worktree, call that worktree's `scripts/` copy instead. The session-band `/gates` pane always uses the canonical `~/dotfiles/scripts/` copies.

1. **Grill.** The `grill-me` skill interviews you and writes `SPEC.md` at the repo root. `shared/templates/spec.md` is the starting template: copy it to the repo root as `SPEC.md` and set `branch:` to the current branch. Lint must pass: the sections Objective, Acceptance Criteria, Boundaries (Always / Ask first / Never) and Open Questions are required.
2. **Approve (human only).** Open the session-band `/gates` pane to find matching specs (`SPEC.md` and `specs/*.md`) and pending Pi reviews across the current repo's worktrees. Select a spec to read every AC and its full verify command, then press Approve. Alternatively, run `~/dotfiles/scripts/ac-run approve SPEC.md` yourself in its worktree. Both paths require a person to click Approve in a macOS dialog; Cancel is the default, and timeout or dialog failure refuses approval. There is no stdin or terminal fallback: piping `y` cannot approve. To read the same complete summary without running commands or changing anything, use `ac-run show SPEC.md`. Approval runs the non-manual commands once for a baseline only when three things hold: a merge-base against `origin/HEAD`, `main` or `master` exists, no non-spec changes have been committed since that merge-base, and the working tree is clean apart from `SPEC.md`. Otherwise the baseline is recorded as unknown, and `check` later reports a passing command as `PASS (no baseline)`. It stores a record under `~/.local/state/ac-run/`, named by a hash of normalized values: the spec path relative to the repo, the branch, the AC ids, and each AC's `verify:` and `baseline:` values with leading and trailing whitespace stripped. Changing one of those values voids the approval (`check` exits 3), but these are limits of the record: leading or trailing whitespace changes keep it, edits to the Objective, Boundaries or AC prose do not void it, and an identical relative spec on the same branch in another repo on the same machine can reuse it. It then writes `status: approved` into `SPEC.md`, but `check` never reads the status line, so the record alone authorizes execution. If `SPEC.md` is read-only, `approve` prints a warning and still exits 0 after writing the record. Agents never run `approve`. `ac-run reject SPEC.md` removes the record for the current verify lines and sets `status: draft`; it runs no command and exits 0 whether or not a record existed. `ac-run status SPEC.md` prints `approved (record matches)`, `draft (no record)` or `stale (spec changed since approval; approve again)`, and exits 0 only when approved.
3. **Implement.** An agent reads `SPEC.md` when its `branch:` matches the current branch, works only toward its AC ids, and obeys its Boundaries.
4. **Verify.** The `verify-spec` skill runs `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard`. `check` exits 0 when every AC is PASS or MANUAL, 1 on FAIL, TIMEOUT or PRE-SATISFIED (an AC that was already true before the change), 2 on a lint or branch error, and 3 when no approval record exists. `floor-guard` is advisory: exit 0 clean, 1 findings, 2 error. It diffs against the merge-base with `origin/HEAD`, `main` or `master`; when none exists it exits 2 with `no base; pass --base <ref>`, so pass `--base <ref>` (a repo with no commits exits 2 even then). It flags added suppressions, skipped or deleted tests, removed assertions, and stubs or swallowed errors, and scans untracked files too. On exit 3 the agent stops and asks the human for approval; on FAIL, TIMEOUT or PRE-SATISFIED it fixes the code and reruns, and it reports `floor-guard` findings as they are, without rewording code to dodge them. Rule 6 says stop after 3 tries, while `verify-spec` allows 3 fix-and-rerun cycles after the first run; this README does not reconcile the two, and where they differ the rule governs. Rule 4 forbids editing a `verify:` line or a test to make a check pass, and `verify-spec` also forbids editing `baseline:` lines. `verify-spec` permits one narrower edit that rule 4 does not mention: replacing the placeholder body of a test stub the agent wrote for this spec with real assertions.
5. **Review and PR.** Review the diff through the gate described in `docs/workflows/agent-review.md` before it is pushed or merged. The gate is a human workflow; neither script enforces it. Then push the branch and open a draft PR.

In `/gates`, `j`/`k` select a row, `a` approves, `x` rejects (press twice to confirm), `e` edits a spec in Neovim, `o` opens a Pi review, and `r` refreshes. Spec state comes from `ac-run status`: draft, approved, stale, or invalid (with the error and approval disabled). Review rows show landed, processing, error and orphan tags; rejecting an orphan skips its leftover refs. `b`/`f` cycle open mod panes, `w` opens Worktrees, and `q` closes Gates. Review approval still uses agent-review's own macOS dialog; detailed diff review stays in Neovim.

Tests for both scripts: `python3 scripts/tests/test_spec_loop.py`. Pane tests: `cd session-band-plugin && claude plugin test .`.

### Stacked pull requests

Use GitHub's `gh stack` extension for a single feature split into dependent,
reviewable layers. Plan layer boundaries before coding; review and approve each
layer through the existing review gate before committing it. Keep unrelated work
in separate stacks.

```sh
# From a clean trunk, create the first named layer (never invoke bare init).
gh stack init feature/foundation
# Commit its reviewed changes, then add the dependent layer.
gh stack add feature/integration
# Publish draft PRs without interactive prompts.
gh stack submit --auto
# Inspect or update the stack non-interactively.
gh stack view --json
gh stack sync --remote origin
```

Agent invocations must use named `init`/`add` branches, `submit --auto`, and
`view --json`; see `docs/workflows/stacked-prs.md` for recovery and review
rules.

### Pi-first workflow

Pi is the only supported agent harness. Commandr is the task service,
DiffView is the review service, and Obsidian is the human UI. Other vendors
are model providers or explicit CLI bridges, not parallel harnesses.

```sh
# Pi TUI
/sessions
/review
```

Legacy `scripts/agent-session` and `.agents/sessions/` remain compatibility
surfaces. New workflow features should target Pi and Commandr, not add another
harness-specific state store.

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
