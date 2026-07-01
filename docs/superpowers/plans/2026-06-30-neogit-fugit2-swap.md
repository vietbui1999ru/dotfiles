# Neogit replaces fugit2.nvim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap fugit2.nvim for neogit as the git-ops UI in `~/dotfiles/nvim`, keeping diffview.nvim as neogit's diff backend and enabling neogit's filewatcher for AI-agent-driven repo changes.

**Architecture:** One-for-one plugin swap inside `nvim/.config/nvim/init.lua`'s existing `vim.pack.add({...})` declaration and eager-load git section, plus one new per-plugin setup file (`lua/custom/plugins/neogit.lua`) replacing the deleted `fugit2.lua`. No other files change.

**Tech Stack:** Neovim 0.12 native `vim.pack` plugin manager, Lua, `NeogitOrg/neogit` (depends on already-installed `plenary.nvim` + `telescope.nvim`), `sindrets/diffview.nvim` (already installed, unchanged).

## Global Constraints

- Plugin manager is `vim.pack` — no lazy.nvim spec tables anywhere in this repo. Every `vim.pack.add` entry is either a bare `gh("owner/repo")` URL or `{ src = gh(...), name = "..." }`.
- Every plugin setup file in `lua/custom/plugins/` starts with `if vim.g.vscode then return end` unless it's meant to load inside VS Code too.
- Keymap: `<leader>gg` opens neogit (per spec, replaces fugit2's `<leader>F`).
- neogit config per spec: `kind = "split"`, `integrations = { diffview = true }`, `filewatcher = { enabled = true, interval = 1000 }`.
- Spec doc: `docs/superpowers/specs/2026-06-30-neogit-fugit2-swap-design.md` — this plan implements it in full; do not deviate from its decisions without checking back.

---

### Task 1: Swap fugit2.nvim for neogit end-to-end

**Files:**
- Modify: `nvim/.config/nvim/init.lua:153` (the `vim.pack.add({...})` entry)
- Modify: `nvim/.config/nvim/init.lua:295-296` (the eager-load packadd/require pair)
- Create: `nvim/.config/nvim/lua/custom/plugins/neogit.lua`
- Delete: `nvim/.config/nvim/lua/custom/plugins/fugit2.lua`

**Interfaces:**
- Consumes: nothing from other tasks (this is the only task in this plan).
- Produces: `<leader>gg` keymap opening neogit; nothing else in this repo depends on it.

This is one task, not split further, because the four file changes only make sense together — `init.lua` referencing `custom.plugins.neogit` before that file exists (or after `fugit2.lua` is gone but `init.lua` still references it) leaves the Neovim config in a broken, unreviewable half-state. A reviewer either accepts the whole swap or none of it.

- [ ] **Step 1: Confirm current fugit2 install exists (baseline for later diffing)**

Run:
```bash
ls ~/.local/share/nvim/site/pack/core/opt/ | grep -iE "fugit2|neogit"
```
Expected: `fugit2.nvim` present, `neogit` absent. This confirms the baseline before any edit — vim.pack installs plugins into `~/.local/share/nvim/site/pack/core/opt/<name>` the first time `packadd` runs against a declared URL.

- [ ] **Step 2: Swap the `vim.pack.add` entry**

In `nvim/.config/nvim/init.lua`, line 153 currently reads:
```lua
	gh("SuperBo/fugit2.nvim"),
```
Replace it with:
```lua
	gh("NeogitOrg/neogit"),
```
Leave every other line in the `vim.pack.add({...})` block (lines ~119-174) untouched, including `gh("sindrets/diffview.nvim")` (line 151) and `gh("kdheepak/lazygit.nvim")` (line 152).

- [ ] **Step 3: Create `lua/custom/plugins/neogit.lua`**

Create `nvim/.config/nvim/lua/custom/plugins/neogit.lua` with:
```lua
if vim.g.vscode then
	return
end

require("neogit").setup({
	kind = "split",
	integrations = { diffview = true },
	filewatcher = { enabled = true, interval = 1000 },
})

vim.keymap.set("n", "<leader>gg", require("neogit").open, { desc = "Neogit: status" })
```
This mirrors the existing `fugit2.lua` gate pattern (`if vim.g.vscode then return end`) and the `lazygit.lua` pattern of calling `require("neogit").open` directly rather than a `<cmd>...<cr>` string, since `neogit.open()` is a Lua function, not a user command.

- [ ] **Step 4: Swap the eager-load packadd/require pair**

In `nvim/.config/nvim/init.lua`, lines 295-296 currently read:
```lua
vim.cmd.packadd("fugit2.nvim")
require("custom.plugins.fugit2")
```
Replace with:
```lua
vim.cmd.packadd("neogit")
require("custom.plugins.neogit")
```
Leave the surrounding lines (287-290 diffview keymaps, 292-293 lazygit, 298-299 octo) untouched.

- [ ] **Step 5: Delete the old fugit2 setup file**

```bash
rm nvim/.config/nvim/lua/custom/plugins/fugit2.lua
```

- [ ] **Step 6: Verify the config loads without errors**

Run:
```bash
nvim --headless -c "lua vim.schedule(function() vim.cmd('qa!') end)" 2>&1
```
Expected: no output referencing `fugit2`, `neogit`, or a Lua traceback. (If neogit needs to install for the first time, this run also triggers that install via `vim.pack.add` processing at the top of `init.lua`.)

- [ ] **Step 7: Verify neogit installed and fugit2 did not survive**

```bash
ls ~/.local/share/nvim/site/pack/core/opt/ | grep -iE "fugit2|neogit"
```
Expected: `neogit` present, `fugit2.nvim` no longer referenced by config (the directory may remain on disk from the old install — that's fine, `vim.pack` doesn't prune automatically — but confirm `nvim/.config/nvim/lua/custom/plugins/fugit2.lua` is gone and nothing in `init.lua` calls `packadd("fugit2.nvim")`):
```bash
grep -rn "fugit2" nvim/.config/nvim/init.lua nvim/.config/nvim/lua/custom/plugins/ 2>/dev/null
```
Expected: no output.

- [ ] **Step 8: Manual smoke test in a real git repo**

Open Neovim in a git repo (e.g. this dotfiles repo itself) and confirm, in order:
1. `<leader>gg` opens neogit in a split (not a tab, not floating).
2. The status buffer shows staged/unstaged files; `s`/`u` stage/unstage a hunk.
3. Pressing `d` on a changed file opens the diff popup, and selecting a diff option hands off to diffview.nvim (recognizable by diffview's file-panel + side-by-side layout), not neogit's own inline diff.
4. With the status buffer open, edit a tracked file from another terminal and `git add`/`git commit` it outside Neovim — confirm the neogit status buffer updates within ~1-2 seconds without pressing anything (filewatcher check).
5. `<leader>gd`, `<leader>gf`, `<leader>gq` (diffview's own keymaps) still work exactly as before, independent of neogit.
6. `<leader>F` no longer does anything (fugit2 is gone) — confirm no error is thrown, it's simply unmapped.

- [ ] **Step 9: `:checkhealth` sanity check**

Run `:checkhealth` inside Neovim (or `nvim --headless -c "checkhealth" -c "qa!" 2>&1` for a text dump) and confirm no new errors or warnings attributable to neogit or the removal of fugit2.

- [ ] **Step 10: Commit**

```bash
git add nvim/.config/nvim/init.lua nvim/.config/nvim/lua/custom/plugins/neogit.lua
git rm nvim/.config/nvim/lua/custom/plugins/fugit2.lua
git commit -m "$(cat <<'EOF'
feat(nvim): replace fugit2.nvim with neogit

Neogit's filewatcher auto-refreshes the status buffer when an AI agent
CLI (Claude Code, opencode, pi) commits or edits files in the same repo
while the buffer is open — fugit2 has no equivalent. diffview.nvim stays
as neogit's diff backend (integrations.diffview = true), so the existing
<leader>gd/gf/gq keymaps and side-by-side diff review are unaffected.
EOF
)"
```

---

## Self-Review

- **Spec coverage:** vim.pack.add swap (spec §Changes/init.lua) → Step 2. packadd/require swap (spec §Changes/init.lua) → Step 4. New `neogit.lua` (spec §Changes) → Step 3, matches the exact config block from the spec. Deleted `fugit2.lua` (spec §Changes) → Step 5. Testing plan (spec §Testing, all 3 points) → Steps 6-9 cover the headless check, manual diffview handoff + filewatcher + independent-diffview-keymaps checks, and `:checkhealth`. Out-of-scope items (spec §Out of scope) are not touched anywhere in this plan.
- **Placeholder scan:** none found — every step has literal file paths, literal code, and literal commands with expected output.
- **Type consistency:** N/A (Lua config, no cross-task function signatures — single task).
