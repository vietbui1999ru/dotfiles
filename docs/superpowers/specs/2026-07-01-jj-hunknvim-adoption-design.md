# jj adoption + hunk.nvim diff-editor

Sub-project 2 of 3 in the git-tooling overhaul (sub-project 1, neogit replacing fugit2.nvim, is done — PR #4, pending merge to main). Sub-project 3 (hunk CLI + DiffViewer integration) is separate and not started.

## Context

- jj (Jujutsu) is not installed anywhere on this machine (`which jj` → nothing) and appears nowhere in this dotfiles repo. Today's workflow is 100% git.
- This dotfiles repo is stow-managed (`README.md`): each top-level directory is a stow package targeting a path under `$HOME`. Packages are declared in a table and in the `stow ...` command in the Quick Start section. Package installation for CLI tools is dual-tracked: `Brewfile` for macOS, `ansible/roles/tools/tasks/main.yml` for Linux (cargo-based installs mirroring the Homebrew list — `git-delta` and `lazygit` both appear in both places).
- Neovim 0.12, native `vim.pack` plugin manager (same as sub-project 1). `nui.nvim` and `nvim-web-devicons` — hunk.nvim's only dependencies per its README — are **already installed and packadd'd** in this config (`init.lua:121-122` declares them, `init.lua:186-187` packadd's them, both before the git-tool section). No new nvim dependency installs are needed.
- This worktree branched before sub-project 1's PR merged, so `init.lua` still shows `fugit2.nvim` (not yet replaced by neogit) at the line numbers referenced below. This spec's changes are independent of that swap and will still apply cleanly regardless of merge order.

## Decisions (from brainstorming)

- **jj mode**: colocated (`jj git init --colocate`), not pure jj. Git remains the source of truth; GitHub, CI, and existing git-native tools (neogit, lazygit, gitsigns) keep working unchanged.
- **Adoption scope**: this dotfiles repo only, for now.
- **Who runs the colocate command, and when**: the user, manually, on their real `~/dotfiles` checkout — not automated by this branch or any subagent. Reasons: `jj git init --colocate` needs to run against the actual primary git checkout (linked git worktrees, like the one used to build this very sub-project, don't support jj colocation the same way as a primary checkout), it's a one-time structural change to a live working copy, and main currently has unrelated in-progress work from a parallel agent session that this sub-project must not disturb.
- **neogit/jj relationship**: coexist, not replace. neogit stays the day-to-day git status/staging/branch UI; jj commands (`jj log`, `jj describe`, `jj new`, `jj split`, etc.) are reached for specifically for jj's history-editing model, with hunk.nvim invoked by jj as its diff-editor when jj needs one.
- **jj config management**: stowed in this repo (new `jj/` package), not left as unmanaged local config — consistent with how every other tool here is managed.
- **hunk.nvim UI**: fixed split (not floating), nested tree mode, default width (35 cols) — matches the existing config's preference for fixed splits over floats (diffview.nvim, oil.nvim, neogit's `kind = "split"` from sub-project 1).
- **Cross-platform parity**: jj is added to both `Brewfile` (macOS) and `ansible/roles/tools/tasks/main.yml` (Linux, via `cargo install jj-cli --locked`, crate name `jj-cli` → binary `jj`) — following the existing `git-delta`/`lazygit` dual-declaration pattern, not left macOS-only.

## Changes

### `Brewfile`

Add, in the "Modern CLI (Rust tools)" section alongside `git-delta`/`lazygit` (current lines 35-36):
```
brew "jj"
```

### `ansible/roles/tools/tasks/main.yml`

Add `{ crate: jj-cli, bin: jj }` to both cargo-install loops (Debian block, current lines 98-103; RedHat block, current lines 144-149) — same loop, same `creates:` pattern as the existing `git-delta` entry:
```yaml
  loop:
    - { crate: eza,       bin: eza    }
    - { crate: bat,       bin: bat    }
    - { crate: git-delta, bin: delta  }
    - { crate: zoxide,    bin: zoxide }
    - { crate: jj-cli,    bin: jj     }
```

### `jj/.config/jj/config.toml` (new stow package)

```toml
[user]
name = "vietbui99"
email = "buiquocviet99@gmail.com"

[ui]
diff-editor = ["nvim", "-c", "DiffEditor $left $right $output"]
diff-instructions = false
```

Identity mirrors `git/.gitconfig`'s `[user]` block. Colocated jj can often read identity from git config automatically, but setting it explicitly in jj's own config avoids relying on that behavior.

### `README.md`

- Add a row to the Packages table (after the `git/` row, current line 16):
  ```
  | `jj/` | `~/.config/jj/config.toml` |
  ```
- Add `jj` to the `stow` command in Quick Start (current line 37):
  ```
  stow zsh starship nvim tmux kitty git jj claude opencode codex
  ```

### `nvim/.config/nvim/init.lua`

- `vim.pack.add({...})`: add `gh("julienvincent/hunk.nvim"),` immediately after the `gh("SuperBo/fugit2.nvim"),` line (current line 153).
- Eager-load git section: add, immediately after the fugit2 `packadd`/`require` pair (current lines 295-296), before the octo.nvim block (current line 298):
  ```lua
  vim.cmd.packadd("hunk.nvim")
  require("custom.plugins.hunk")
  ```

### `nvim/.config/nvim/lua/custom/plugins/hunk.lua` (new)

```lua
if vim.g.vscode then return end

require("hunk").setup({
	ui = {
		tree = { mode = "nested", width = 35, use_float = false },
	},
})
```

No keymap is defined here — hunk.nvim's `:DiffEditor` command is invoked by jj itself (via `ui.diff-editor` in `jj/.config/jj/config.toml`), not called directly by the user.

## Manual step (not part of this branch)

Once this branch is merged, `brew bundle` has installed `jj`, and `stow jj` has linked the config:

```sh
cd ~/dotfiles && jj git init --colocate
```

Run this once main is quiet (no parallel agent work in progress). This is a one-time structural change to the live `~/dotfiles` checkout and is intentionally left as a manual, human-run step rather than something this branch or any subagent executes.

## Testing

1. `brew info jj` after a `brew bundle` run (or `brew install jj` standalone) confirms the formula resolves.
2. `stow -n -v jj` (dry run) from the repo root confirms `jj/.config/jj/config.toml` would symlink to `~/.config/jj/config.toml` without conflicts.
3. Once jj is installed: `jj config list --config-file jj/.config/jj/config.toml` (or after stowing, plain `jj config list`) confirms the TOML parses and reports the expected `user.name`, `user.email`, `ui.diff-editor`, `ui.diff-instructions` values.
4. `nvim --headless` isolated module load for `custom.plugins.hunk` (same pattern used in sub-project 1's verification): packadd `nui.nvim`, `nvim-web-devicons`, `hunk.nvim`, then `require("custom.plugins.hunk")`, confirm no traceback.
5. `grep -c "hunk.nvim" nvim/.config/nvim/init.lua` — expect exactly 2 (the `vim.pack.add` entry and the `packadd` call).
6. Manual, after the user runs the colocate step themselves: `jj new`, edit a file, `jj diff --tool nvim` (or any jj operation that triggers `ui.diff-editor`) opens hunk.nvim's `DiffEditor` UI in a split with a nested file tree.

## Out of scope

- Actually running `jj git init --colocate` against the real `~/dotfiles` checkout (manual step, see above).
- Any repo other than dotfiles.
- hunk CLI (hunkdiff) / DiffViewer integration (sub-project 3, separate spec).
- Any change to neogit, diffview.nvim, lazygit.nvim, gitsigns.nvim, or octo.nvim.
- jj aliases, revsets, or any config beyond identity + diff-editor wiring.
