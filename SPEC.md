---
status: approved
branch: feat/nvim-review-dashboard
---
# SPEC: Neovim start screen shows agent reviews waiting for approval (Track B)

## Objective
When Neovim opens on the snacks.nvim dashboard, an "Agent Reviews" area in pane 2 shows the pending agent reviews across repos and worktrees, and Enter on one opens it in `:AgentReview`. Success: with reviews pending in two repos, the dashboard lists both within a few seconds of opening, startup is never blocked waiting for the scan, and selecting a row opens that review with the tab's directory set to its worktree.

This is one of two specs meant to be built by parallel sessions. Track A (branch `feat/agent-review-global`, its own SPEC.md) adds `agent-review list --global --json`. This track depends only on that command's contract and tests against a stub CLI, so it does not wait for Track A. Until Track A is merged, the live dashboard shows the "agent-review unavailable" row.

### Contract consumed from Track A
`agent-review list --global --json` prints one JSON array and exits 0. Each element has `runId`, `owner` (worktree path, or null for an orphan), `branch`, `name`, `startedAt`, `processing`, `error`, `landed`, `orphan`, and `repo` (the repo's main-worktree path). The order is non-orphans first, then oldest first.

### Decisions
- D1: A new module `nvim/.config/nvim/lua/custom/agent_review_dashboard.lua` owns the area. Its `cli` field defaults to the same `scripts/agent-review` path that `custom.agent_review` derives, and tests override it.
- D2: Scanning is asynchronous (`vim.system` with an exit callback, never `:wait()`). The section renders from the module's cache immediately, starts a refresh each time the dashboard opens (`User SnacksDashboardOpened`), and calls `Snacks.dashboard.update()` when the refresh finishes.
- D3: Rows are non-orphan entries only, not yet landed first and then landed, capped at 5, with a final "+N more: :AgentReview" row when there are more. Each row shows the repo directory name, the review name (or the first 8 characters of the runId), the branch and the age, plus `[landed]`, `[processing]` or `[error]` tags. The title count is the number of non-orphan, non-landed entries.
- D4: Enter on a row runs `tcd` to the entry's `owner` and then `require("custom.agent_review").open_in(owner, runId)`, the same thing `:AgentReview` does after its picker. A `[processing]` row only shows a warning. The "+N more" row runs `:AgentReview`.
- D5: Fixed rows cover the other states: "Checking agent reviews..." before the first result, "No agent reviews waiting" when the list is empty, and "agent-review unavailable" when the CLI fails or prints something that is not a JSON array.
- D6: `lua/custom/plugins/snacks.lua` adds the section to pane 2, above Recent Files. No other dashboard section changes.

## Acceptance Criteria
- AC-1: Contract entries become rows in the D3 order, with orphans left out, the repo name, review name, branch and tags in each label, and a title count that leaves out landed entries
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua rows_from_contract`
- AC-2: An empty list gives the single "No agent reviews waiting" row with no action
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua empty_list`
- AC-3: A CLI that is missing, exits non-zero or prints something other than a JSON array gives the "agent-review unavailable" row
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua cli_failure`
- AC-4: With a stub CLI that sleeps 2 s, building the section returns in under 100 ms with the "Checking agent reviews..." row, and when the CLI finishes the cache is filled and `Snacks.dashboard.update` is called once
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua non_blocking`
- AC-5: Enter on a row sets the tab directory to the entry's owner and calls `open_in(owner, runId)`; on a `[processing]` row it warns and does not call `open_in`
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua open_action`
- AC-6: Seven fresh entries give 5 rows plus a "+2 more" row whose action runs `:AgentReview`
  verify: `nvim --clean --headless -l scripts/agent-review-dashboard-nvim-test.lua row_cap`
- AC-7: The snacks dashboard config includes the section in pane 2
  verify: `rg -q "agent_review_dashboard" nvim/.config/nvim/lua/custom/plugins/snacks.lua`
- AC-8: Existing Neovim agent-review checks still pass
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-test.lua`
  baseline: pass
- AC-9: Existing cross-worktree Neovim checks still pass
  verify: `nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua single_opens_owner && nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua picker_order_and_tags && nvim --clean --headless -l scripts/agent-review-nvim-xwt-test.lua cli_failure_fallback`
  baseline: pass
- AC-10: Use-test: once Track A is merged and repos are registered, opening `nvim` with no arguments shows the area filling in after the dashboard appears, lists reviews from dotfiles worktrees and another repo, and Enter on one opens it in diffview
  verify: manual - visual check in a real terminal with the real dashboard

## Boundaries
### Always
- Follow `scripts/agent-review-nvim-xwt-test.lua`: one case per process, stubbed `diffview`, `gitsigns` and `Snacks`, and a temporary stub CLI script instead of the real one
- Keep startup non-blocking: no synchronous `vim.system(...):wait()` on the dashboard path
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Adding a plugin or a lualine, statusline or notification indicator
- Changing existing dashboard sections or the pane layout beyond adding this section
### Never
- Approve or skip from the dashboard; approval stays with the session-band gates pane and `agent-review approve` and its dialog
- Edit `scripts/agent-review` or the Pi extension; they belong to Track A
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Should landed reviews appear at all? Default: yes, after the fresh ones and tagged `[landed]`, so they can be found and skipped; they don't count in the title.
- Should the area refresh on a timer while the dashboard stays open? Default: no, only on dashboard open; the "+N more" row and `:AgentReview` are always live.
- Should rows get number hotkeys? Default: no, so they can't collide with the keys section; use the cursor and Enter.
