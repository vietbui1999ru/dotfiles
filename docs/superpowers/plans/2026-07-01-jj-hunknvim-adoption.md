# jj adoption + hunk.nvim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Declare jj (Jujutsu) as a managed tool across this dotfiles repo (Brewfile, ansible, a stowed jj config) and wire `julienvincent/hunk.nvim` into Neovim as jj's diff-editor — without touching the user's live main checkout or actually running `jj git init --colocate` anywhere (that's an explicit manual step for the user, outside this plan).

**Architecture:** Two independent, disjoint-file tasks. Task 1 declares jj as an installable/stowable tool (package manager entries + its own config file + docs). Task 2 wires hunk.nvim into the existing Neovim `vim.pack` git-tool section, following the exact same pattern sub-project 1 used for neogit. Neither task depends on the other; either can be reviewed and merged independently.

**Tech Stack:** Homebrew (`Brewfile`), Ansible (`ansible/roles/tools/tasks/main.yml`, cargo-based installs on Debian/RedHat), GNU Stow (new `jj/` package), TOML (jj's config format), Neovim 0.12 native `vim.pack`, Lua.

## Global Constraints

- jj mode: colocated only (`jj git init --colocate`), never pure jj. This plan does not run that command — it's a documented manual step for the user.
- Adoption scope: this dotfiles repo only. No other repo is touched.
- jj config lives in this repo as a stowed package (`jj/.config/jj/config.toml`), not left unmanaged.
- hunk.nvim UI: fixed split, nested tree mode, width 35 (hunk.nvim's default) — no floating window.
- Cross-platform parity: jj must appear in both `Brewfile` (macOS) and `ansible/roles/tools/tasks/main.yml` (Linux, cargo crate `jj-cli`, binary `jj`), matching the existing `git-delta`/`lazygit` dual-declaration pattern.
- hunk.nvim's dependencies (`nui.nvim`, `nvim-web-devicons`) are already installed and packadd'd in `init.lua` (lines 121-122, 186-187) — no new nvim dependency installs.
- Spec doc: `docs/superpowers/specs/2026-07-01-jj-hunknvim-adoption-design.md` — this plan implements it in full; do not deviate from its decisions without checking back.

---

### Task 1: Declare jj as a managed, stowable tool

**Files:**
- Modify: `Brewfile:35-36` (insert after `brew "git-delta"` / `brew "lazygit"`)
- Modify: `ansible/roles/tools/tasks/main.yml:103-106` (Debian cargo loop) and `:149-152` (RedHat cargo loop)
- Create: `jj/.config/jj/config.toml`
- Modify: `README.md:16` (Packages table) and `README.md:37` (stow command)

**Interfaces:**
- Consumes: nothing from Task 2.
- Produces: nothing Task 2 depends on — these are independent deliverables.

- [ ] **Step 1: Add jj to the Brewfile**

In `Brewfile`, the "Modern CLI (Rust tools)" section currently reads (lines 30-37):
```
# Modern CLI (Rust tools)
brew "eza"
brew "bat"
brew "ripgrep"
brew "fd"
brew "git-delta"
brew "lazygit"
brew "fzf"
brew "zoxide"
```
Add `brew "jj"` immediately after `brew "lazygit"`:
```
brew "git-delta"
brew "lazygit"
brew "jj"
```

- [ ] **Step 2: Add jj to the ansible Debian cargo-install loop**

In `ansible/roles/tools/tasks/main.yml`, the Debian loop currently reads (lines 102-106):
```yaml
  loop:
    - { crate: eza,       bin: eza    }
    - { crate: bat,       bin: bat    }
    - { crate: git-delta, bin: delta  }
    - { crate: zoxide,    bin: zoxide }
```
Change to:
```yaml
  loop:
    - { crate: eza,       bin: eza    }
    - { crate: bat,       bin: bat    }
    - { crate: git-delta, bin: delta  }
    - { crate: zoxide,    bin: zoxide }
    - { crate: jj-cli,    bin: jj     }
```

- [ ] **Step 3: Add jj to the ansible RedHat cargo-install loop**

Same change, RedHat block currently at lines 148-152:
```yaml
  loop:
    - { crate: eza,       bin: eza    }
    - { crate: bat,       bin: bat    }
    - { crate: git-delta, bin: delta  }
    - { crate: zoxide,    bin: zoxide }
```
Change to:
```yaml
  loop:
    - { crate: eza,       bin: eza    }
    - { crate: bat,       bin: bat    }
    - { crate: git-delta, bin: delta  }
    - { crate: zoxide,    bin: zoxide }
    - { crate: jj-cli,    bin: jj     }
```

- [ ] **Step 4: Validate the ansible YAML still parses**

```bash
python3 -c "import yaml; yaml.safe_load(open('ansible/roles/tools/tasks/main.yml'))" && echo "YAML valid"
```
Expected: `YAML valid`. (If `yaml` isn't available as a Python module, use `ansible-playbook --syntax-check ansible/site.yml` instead, or `python3 -c "import yaml"` first to confirm the module exists before relying on this check — if neither is available, visually diff the loop blocks against Step 2/3's exact text instead.)

- [ ] **Step 5: Create the jj stow package**

Create `jj/.config/jj/config.toml`:
```toml
[user]
name = "vietbui99"
email = "buiquocviet99@gmail.com"

[ui]
diff-editor = ["nvim", "-c", "DiffEditor $left $right $output"]
diff-instructions = false
```

- [ ] **Step 6: Validate the TOML parses**

```bash
python3 -c "import tomllib; tomllib.load(open('jj/.config/jj/config.toml', 'rb'))" && echo "TOML valid"
```
Expected: `TOML valid`. (Python 3.11+ ships `tomllib` in the standard library. If the environment's `python3` is older, fall back to `python3 -c "import toml; toml.load(open('jj/.config/jj/config.toml'))"` if the third-party `toml` package is available, or `pip install --user tomli && python3 -c "import tomli; tomli.load(open('jj/.config/jj/config.toml','rb'))"` if neither is present.)

- [ ] **Step 7: Confirm stow would link the new package without conflicts**

From the repo root:
```bash
stow -n -v jj
```
Expected output shows a `LINK:` line for `.config/jj/config.toml` pointing into the repo, and no `CONFLICT` lines. (Requires `stow` to be installed — it's already a `Brewfile` entry (`brew "stow"`), so it should be present on this machine.)

- [ ] **Step 8: Update the README Packages table**

In `README.md`, the Packages table currently has this row order (lines 9-19):
```
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
```
Add a `jj/` row immediately after the `git/` row:
```
| `git/` | `~/.gitconfig` |
| `jj/` | `~/.config/jj/config.toml` |
| `claude/` | `~/.claude/` |
```

- [ ] **Step 9: Update the README stow command**

Line 37 currently reads:
```
stow zsh starship nvim tmux kitty git claude opencode codex
```
Change to (insert `jj` after `git`):
```
stow zsh starship nvim tmux kitty git jj claude opencode codex
```

- [ ] **Step 10: Commit**

```bash
git add Brewfile ansible/roles/tools/tasks/main.yml jj/.config/jj/config.toml README.md
git commit -m "$(cat <<'EOF'
feat(jj): declare jj as a managed, stowable tool

Adds jj to Brewfile and the ansible cargo-install loops (Debian +
RedHat), following the existing git-delta/lazygit dual-declaration
pattern. New jj/ stow package wires identity + hunk.nvim as the
diff-editor. Does not run `jj git init --colocate` anywhere — that's
a manual step on the user's live checkout, documented in the spec.
EOF
)"
```

---

### Task 2: Wire hunk.nvim as a Neovim git tool

**Files:**
- Modify: `nvim/.config/nvim/init.lua:153` (the `vim.pack.add({...})` entry, insert after fugit2's line)
- Modify: `nvim/.config/nvim/init.lua:295-296` (insert after the fugit2 packadd/require pair, before the octo.nvim block)
- Create: `nvim/.config/nvim/lua/custom/plugins/hunk.lua`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing Task 1 depends on. `jj/.config/jj/config.toml`'s `ui.diff-editor` (from Task 1) references the `nvim -c "DiffEditor ..."` command this task's `hunk.lua` setup makes available — that connection is exercised at runtime by jj itself, not by any code in either task, so there's no compile-time or file-level dependency between the two tasks.

Note: this worktree currently still has `fugit2.nvim` in `init.lua` (sub-project 1's neogit PR hasn't merged yet). The line numbers below match the current state of this file in this worktree. If sub-project 1 merges into main before this task is implemented, `git merge main` (or a rebase) into this branch first, then re-check these exact line numbers before editing — the `fugit2.nvim` lines will have become `neogit` lines, but the insertion point (immediately after that pair, before octo.nvim) is unchanged either way.

- [ ] **Step 1: Add hunk.nvim to `vim.pack.add`**

In `nvim/.config/nvim/init.lua`, line 153 currently reads:
```lua
	gh("SuperBo/fugit2.nvim"),
```
Add immediately after it:
```lua
	gh("SuperBo/fugit2.nvim"),
	gh("julienvincent/hunk.nvim"),
```

- [ ] **Step 2: Create `lua/custom/plugins/hunk.lua`**

Create `nvim/.config/nvim/lua/custom/plugins/hunk.lua`:
```lua
if vim.g.vscode then
	return
end

require("hunk").setup({
	ui = {
		tree = { mode = "nested", width = 35, use_float = false },
	},
})
```
No keymap is defined — hunk.nvim's `:DiffEditor` command is invoked by jj via `ui.diff-editor` (Task 1's `jj/.config/jj/config.toml`), not called directly by the user.

- [ ] **Step 3: Add the packadd/require pair**

In `nvim/.config/nvim/init.lua`, lines 295-296 currently read:
```lua
vim.cmd.packadd("fugit2.nvim")
require("custom.plugins.fugit2")
```
Add immediately after (before the `vim.cmd.packadd("octo.nvim")` line at 298):
```lua
vim.cmd.packadd("fugit2.nvim")
require("custom.plugins.fugit2")

vim.cmd.packadd("hunk.nvim")
require("custom.plugins.hunk")
```

- [ ] **Step 4: Verify the module loads cleanly in isolation**

The full `init.lua` cannot be run headless to completion due to a pre-existing, unrelated `image.nvim`/kitty-backend crash (confirmed during sub-project 1) — this is not something this task fixes. Verify `hunk.lua` in isolation instead, mirroring sub-project 1's verification approach:
```bash
nvim --headless -u NONE --cmd "set rtp+=$PWD/nvim/.config/nvim" \
  -c "lua vim.cmd.packadd('nui.nvim')" \
  -c "lua vim.cmd.packadd('nvim-web-devicons')" \
  -c "lua vim.cmd.packadd('hunk.nvim')" \
  -c "lua require('custom.plugins.hunk')" \
  -c "lua print('HUNK_LOADED_OK')" \
  -c "qa!" 2>&1
```
Expected: the last line of output is `HUNK_LOADED_OK` with no Lua traceback above it. (If `hunk.nvim` hasn't been installed via `vim.pack` yet in this environment, run `nvim --headless -c "lua vim.pack.add({'https://github.com/julienvincent/hunk.nvim'})" -c "qa!" 2>&1` first to trigger the install — `vim.pack.add` installs on first reference regardless of which config file declares it, since installs land in the shared `~/.local/share/nvim/site/pack/core/opt/` directory.)

- [ ] **Step 5: Verify the plugin declaration count**

```bash
grep -c "hunk.nvim" nvim/.config/nvim/init.lua
```
Expected: `2` (one `vim.pack.add` entry, one `packadd` call).

```bash
grep -n "hunk" nvim/.config/nvim/init.lua
```
Expected: exactly two lines — the `gh("julienvincent/hunk.nvim"),` line and the `vim.cmd.packadd("hunk.nvim")` line (the `require("custom.plugins.hunk")` line contains "hunk" too via the module path, so this second grep should actually show 3 matching lines total — confirm all three are the expected ones and nothing else references "hunk" unexpectedly, e.g. no accidental duplicate).

- [ ] **Step 6: Confirm no unrelated files changed**

```bash
git diff --stat
```
Expected: only `nvim/.config/nvim/init.lua` (modified) and `nvim/.config/nvim/lua/custom/plugins/hunk.lua` (new) appear — no changes to `diffview.nvim`, `lazygit.nvim`, `fugit2.nvim` (or `neogit.lua`, if already merged), `gitsigns.nvim`, or `octo.nvim` configuration.

- [ ] **Step 7: Commit**

```bash
git add nvim/.config/nvim/init.lua nvim/.config/nvim/lua/custom/plugins/hunk.lua
git commit -m "$(cat <<'EOF'
feat(nvim): add hunk.nvim as jj's diff-editor

Wires julienvincent/hunk.nvim into the vim.pack git-tool section,
fixed split + nested tree mode per the design spec. No keymap needed —
invoked by jj via ui.diff-editor (see jj/.config/jj/config.toml),
never called directly. Dependencies (nui.nvim, nvim-web-devicons)
were already installed for other plugins.
EOF
)"
```

---

## Self-Review

- **Spec coverage:** Brewfile entry (spec §Changes/Brewfile) → Task 1 Step 1. Ansible Debian+RedHat entries (spec §Changes/ansible) → Task 1 Steps 2-3. jj config.toml (spec §Changes/jj config) → Task 1 Step 5, exact content matches. README table + stow command (spec §Changes/README.md) → Task 1 Steps 8-9. hunk.nvim vim.pack entry + packadd/require + setup file (spec §Changes/init.lua, §Changes/hunk.lua) → Task 2 Steps 1-3, exact content matches. Testing plan (spec §Testing, all 6 points) → Task 1 Steps 4/6/7 cover ansible YAML validity, TOML validity, stow dry-run; Task 2 Steps 4-6 cover the headless module load and grep checks; spec's testing point 6 (manual jj diff-editor trigger after the user runs the colocate step) is explicitly a post-merge, user-run check, not a plan step — correctly left as the spec's documented manual follow-up, not fabricated as an automated step here. Out-of-scope items (spec §Out of scope) are not touched by either task.
- **Placeholder scan:** none found — every step has literal file paths, literal code/config content, and literal commands with expected output.
- **Type consistency:** N/A (config files, no cross-task function signatures; Task 1 and Task 2 are file-disjoint as designed).
