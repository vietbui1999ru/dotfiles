# Neogit replaces fugit2.nvim

Sub-project 1 of 3 in the git-tooling overhaul (see: jj + hunk.nvim adoption, hunk CLI + DiffViewer integration — separate specs).

## Context

`~/dotfiles/nvim/.config/nvim` runs Neovim 0.12 with the native `vim.pack` plugin manager (not lazy.nvim). Plugin URLs are declared once in `init.lua`'s `vim.pack.add({...})` call; each plugin is then explicitly activated with `vim.cmd.packadd("name")` followed by a `require("custom.plugins.name")` call that does setup + keymaps. Per-plugin setup files live in `lua/custom/plugins/*.lua` and are gated with `if vim.g.vscode then return end` where the plugin shouldn't load inside the VS Code Neovim extension.

Current git stack: `gitsigns.nvim` (inline hunk signs), `diffview.nvim` (`<leader>gd/gf/gq`, side-by-side diff), `fugit2.nvim` (`<leader>F`, Magit-inspired status/staging UI, hardcoded `libgit2_path`), `lazygit.nvim` (`<leader>lg`, TUI). No neogit, no jj, no hunk.nvim anywhere in the repo.

## Goal

Replace fugit2.nvim with neogit as the git-ops UI, keeping diffview.nvim as neogit's diff backend, and enable neogit's filewatcher so the status buffer auto-refreshes when an AI agent CLI (Claude Code, opencode, pi) commits or edits files in the same repo while the buffer is open.

## Decisions (from brainstorming)

- **Diff backend**: neogit's diff popup hands off to diffview.nvim (`integrations.diffview = true`). diffview.nvim's own `<leader>gd/gf/gq` keymaps are untouched.
- **Keymap**: `<leader>gg` opens neogit (replaces `<leader>F`), keeping the `<leader>g*` namespace consistent with diffview's `<leader>gd/gf/gq` and gitsigns' `<leader>gp/gh/gu`.
- **Filewatcher**: enabled, 1000ms interval (neogit default) — this is the concrete AI-agent-workflow fit: agent-driven commits/file changes show up in the status buffer within ~1s without a manual refresh.
- **Window kind**: `split`.
- **Out of scope**: the pre-existing `octo.nvim` double-`packadd` bug (eager load at init.lua:298-299, duplicate deferred load at init.lua:495-496) — real, but unrelated to this swap. Not touched by this change.

## Changes

### `init.lua`

- `vim.pack.add({...})`: replace `gh("SuperBo/fugit2.nvim")` (line 153) with `gh("NeogitOrg/neogit")`.
- Eager-load git section (lines 295-296): replace
  ```lua
  vim.cmd.packadd("fugit2.nvim")
  require("custom.plugins.fugit2")
  ```
  with
  ```lua
  vim.cmd.packadd("neogit")
  require("custom.plugins.neogit")
  ```
- No changes to the `diffview.nvim` or `gitsigns.nvim` lines.

### `lua/custom/plugins/neogit.lua` (new)

```lua
if vim.g.vscode then return end

require("neogit").setup({
  kind = "split",
  integrations = { diffview = true },
  filewatcher = { enabled = true, interval = 1000 },
})

vim.keymap.set("n", "<leader>gg", require("neogit").open, { desc = "Neogit: status" })
```

### `lua/custom/plugins/fugit2.lua` (deleted)

Fugit2's `libgit2_path` hardcode (`/opt/homebrew/lib/libgit2.dylib`) goes away with it — neogit shells out to the `git` CLI, no libgit2 binding required.

## Dependencies

Already satisfied by the existing config — no new installs beyond neogit itself:
- `plenary.nvim` — declared line 120, `packadd`'d line 185, before the git section.
- `telescope.nvim` — used by neogit's built-in finder for branch/commit selection.
- `diffview.nvim` — already present, becomes neogit's diff backend.

## Testing

1. `nvim --headless "+packadd neogit" +q` — confirms the pack resolves and installs cleanly.
2. Manual, in a real git repo:
   - `<leader>gg` opens neogit in a split.
   - Stage/unstage a hunk from the status buffer.
   - Open the diff popup (`d`) on a changed file, confirm it hands off to diffview.nvim (not neogit's inline diff).
   - With the status buffer open, edit/commit a file from another terminal (or have an agent CLI touch the repo) — confirm the status buffer reflects it within ~1s without manual `<c-r>`.
   - `<leader>gd/gf/gq` (diffview) still work independently of neogit.
3. `:checkhealth` — no new errors from the neogit swap.

## Out of scope

- jj adoption and hunk.nvim (separate spec).
- hunk CLI / DiffViewer integration (separate spec).
- Fixing the `octo.nvim` double-load bug.
- Any change to `gitsigns.nvim`, `lazygit.nvim`, or their keymaps.
