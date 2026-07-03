---
status: active
updated: 2026-07-01T19:05:00Z
repo: /Users/vietquocbui/dotfiles
goal: "Build Neovim + Pi/OMP AI operator cockpit with Cursor-like context handoff, Commandr/DiffViewer integration, and Pi TUI components without CodeCompanion."
---

# Session State — Neovim + Pi/OMP AI Operator Cockpit

## Current Goal

Build and validate a Neovim + Pi/OMP AI workflow layer that keeps Neovim as
the operator IDE, Commandr as the L3 lifecycle bus, DiffViewer as L5
review/evidence UI, and Pi/OMP as agent runners. CodeCompanion was explicitly
skipped.

## Completed This Session

### Phase 1 — Read-only cockpit

Created Neovim modules:

- `nvim/.config/nvim/lua/custom/plugins/pi-status.lua`
  - Reads `~/.pi/status/*.json`.
  - Provides lualine segment and `<leader>as` floating Pi session viewer.
- `nvim/.config/nvim/lua/custom/plugins/commandr-board.lua`
  - Reads repo `.agents/{inbox,claimed,done}` and `events.jsonl`.
  - Provides `<leader>ab` Commandr task board.

### Phase 2 — Guarded Commandr actions

Extended `commandr-board.lua` with guarded actions:

- `e` open packet
- `y` yank task id
- `p` append `task_progress`
- `x` complete pass/fail via `complete`
- `l` launch `commandr-omp-runner`
- `q` close, `r` refresh

### Phase 3 — Evidence bridge

Created:

- `nvim/.config/nvim/lua/custom/plugins/evidence.lua`
  - `<leader>ae` captures LSP diagnostics into `.agents/annotations/` via
    `annotate-write`.
  - `<leader>ad` captures DAP session snapshots.
  - `<leader>ah` pins current diff hunk evidence via gitsigns/git diff.

### AI layer — no CodeCompanion

Implemented a lightweight Pi/OMP AI layer instead of an editor chat plugin:

- `nvim/.config/nvim/lua/custom/plugins/pi-ai.lua`
  - `<leader>aC` exports Neovim context to project `.pi/nvim-context.json` and
    global `~/.cache/pi-nvim/context.json`.
  - `<leader>aa` asks Pi with exported context attached as `@file`.
  - `<leader>aA` asks OMP with exported context attached as `@file`.
  - `<leader>ai` opens Pi TUI in split terminal with context attached.
  - `<leader>aO` opens OMP TUI in split terminal with context attached.

Created and now versioned Pi extension:

- `pi/.pi/agent/extensions/neovim-cockpit.ts`
  - Registered `/cockpit` overlay panel for Pi TUI.
  - Registered `/nvim-context`, `/nvim-context paste`, `/nvim-refresh`.
  - Registered `nvim_context` tool for latest Neovim context.
  - Added `#TASK` Commandr task autocomplete from `.agents/`.
  - Added persistent footer status with Neovim context + Commandr task counts.
- `~/.pi/agent/extensions/neovim-cockpit.ts` is now a symlink to the tracked
  dotfiles copy above.

Updated docs/config:

- `README.md`
  - Added `pi/` stow package and quick-start `stow ... pi`.
  - Documented the Pi extension commands/tool/autocomplete.
- `nvim/.config/nvim/README.md`
  - Replaced stale Claude AI keymap section with Pi/OMP/Commandr cockpit keys.
- `.gitignore`
  - Ignores generated `/.pi/nvim-context.json`.
- `nvim/.config/nvim/init.lua`
  - Requires `pi-status`, `commandr-board`, `evidence`, and `pi-ai` in VimEnter.
  - Adds lualine Pi status segment.
  - Adds which-key `<leader>a` group entries for cockpit commands.
- Fixed `commandr-board.lua` bug: `repo_root_from_bus()` now strips exactly
  `"/.agents"` with `#bus - 8`, not `#bus - 9`.

## Design/Architecture Findings

Important sources checked:

- `~/repos/DiffViewer/docs/V0.7-CONTROL-PLANE-COCKPIT-PLAN.md`
  - Confirms DiffViewer owns L5 cockpit projections, evidence browsing,
    Neovim bridge, review packages.
  - Commandr remains authoritative lifecycle state.
- `~/repos/DiffViewer/docs/ARCHITECTURE.md`
  - Confirms DiffViewer server endpoints: `/stream`, `/steer`, `/annotate`,
    `/api/architecture`.
  - Confirms existing Neovim Lua client as SSE client.
- `~/repos/Commandr/docs/plans/PLAN-control-plane-runner-packages.md`
  - Confirms action vocabulary boundaries.
  - `annotation.create` is bus-safe via `annotate-write`.
  - Level 2 OMP RPC host tools are designed but not implemented.
- Pi docs read:
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/tui.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`
  - `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/rpc.md`

Notes:

- `~/repos/llm-wiki/concepts` does not exist on disk. Relevant Neovim synthesis
  files do exist under `wiki/syntheses` and `docs-site/syntheses`.
- Existing DiffViewer Pi package `~/repos/DiffViewer/pi-extension` is worker-side
  diff review gate, not cockpit; it is already listed in `~/.pi/agent/settings.json`.
- `~/.config/nvim/package.json` includes `acp-claude-code`, but
  `.bin/acp-claude-code` currently fails with `ERR_MODULE_NOT_FOUND` because
  `.bin` points incorrectly to `.bin/index.js`. No CodeCompanion/ACP integration
  was built.

## Validation Done

Latest validation passed:

```sh
luac -p nvim/.config/nvim/init.lua
luac -p nvim/.config/nvim/lua/custom/plugins/pi-ai.lua
luac -p nvim/.config/nvim/lua/custom/plugins/commandr-board.lua
luac -p nvim/.config/nvim/lua/custom/plugins/evidence.lua
luac -p nvim/.config/nvim/lua/custom/plugins/pi-status.lua
nvim --headless -u nvim/.config/nvim/init.lua +'lua require("custom.plugins.pi-ai").write_context()' +qa
pi --no-extensions --extension /Users/vietquocbui/dotfiles/pi/.pi/agent/extensions/neovim-cockpit.ts --no-tools --no-session --print '/nvim-refresh'
git check-ignore -v .pi/nvim-context.json
```

Results:

- Lua syntax checks passed.
- Headless Neovim require/context export passed.
- Pi extension command load passed.
- `.pi/nvim-context.json` is ignored by `.gitignore`.

Diagnostics:

- `lsp_diagnostics` on changed Lua files reports only informational typo
  warnings in pre-existing strings/comments.
- `lens_diagnostics mode=all` reports Markdown warnings in `README.md`, mostly
  pre-existing line-length/table-style warnings; no blocking code errors found.

## In Progress / Incomplete

1. Real interactive UI tests still need to be run outside headless mode:
   - Neovim: `<leader>as`, `<leader>ab`, `<leader>aC`, `<leader>aa`,
     `<leader>aA`, `<leader>ai`, `<leader>aO`, `<leader>ae/ad/ah`.
   - Pi TUI: `/cockpit`, `/nvim-context`, `/nvim-context paste`,
     `nvim_context` tool, `#TASK` autocomplete.
2. Potential cleanup: decide whether to reduce Markdown lint noise in README
   files (line length/table compact style). Not blocking.
3. Potential future work:
   - Add DiffViewer server launcher/status from Neovim (`localhost:3333`
     currently not running).
   - Add deep link from DiffViewer cards to Neovim file/line.
   - Add generated review package artifact under `.diffviewer/artifacts/<task>/`.
   - Add OMP `--mode rpc` integration when Commandr Level 2 host tools are
     implemented.

## Current Git Status Notes

Relevant intended changes in `~/dotfiles` include:

- Modified:
  - `.gitignore`
  - `README.md`
  - `nvim/.config/nvim/README.md`
  - `nvim/.config/nvim/init.lua`
- Added / untracked:
  - `nvim/.config/nvim/lua/custom/plugins/pi-status.lua`
  - `nvim/.config/nvim/lua/custom/plugins/commandr-board.lua`
  - `nvim/.config/nvim/lua/custom/plugins/evidence.lua`
  - `nvim/.config/nvim/lua/custom/plugins/pi-ai.lua`
  - `pi/.pi/agent/extensions/neovim-cockpit.ts`

There are unrelated pre-existing modifications in dotfiles; do not assume they
belong to this cockpit task:

- `claude/.claude/hooks/context-threshold-check.sh`
- `claude/.claude/settings.json`
- `claude/.claude/statusline-command.sh`
- `nvim/.config/nvim/nvim-pack-lock.json`
- `nvim/.config/nvim/package.json`
- `nvim/.gitignore`
- `nvim/.stow-local-ignore`
- `opencode/.config/opencode/opencode.json`
- `repos/llm-wiki`
- `zsh/.zshrc`
- `.claude/`
- `.Codex/`

## Exact Next Steps For Next Session

1. Run interactive smoke tests in a real terminal:
   - Open Neovim normally.
   - Test `<leader>aC` and inspect generated JSON.
   - Test `<leader>aa`, `<leader>aA`, `<leader>ai`, `<leader>aO` terminal launch.
   - Start `pi`, run `/cockpit`, `/nvim-context`, `/nvim-context paste`.
   - Verify `#TASK` autocomplete in a repo with `.agents/`.
2. If interactive tests pass, stage only the intended cockpit/dotfiles files and
   avoid unrelated user changes.
3. Optional architecture follow-up:
   - Add `docs/COCKPIT-ACTIONS.md` in DiffViewer/Commandr only if turning
     Neovim actions into shared L5 action registry entries.
   - Keep Commandr bus boundaries intact: lifecycle/progress/annotations only
     via `bin/*` commands.
