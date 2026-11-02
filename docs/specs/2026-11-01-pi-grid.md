---
status: approved
branch: feat/pi-grid
---
# SPEC: Even grid layout for Pi panes

## Objective
Dispatched Pi panes stop halving each other. Today `scripts/pi-layout.mjs` splits the newest pane 50/50, so the third run beside Claude gets a quarter of the column, and the `pi` and `verdict` tabs stack downward the same way. Success: at most 2 runs sit beside Claude in an even column; further runs fill an even, width-sized grid in the `pi` tab (cap 6, then `pi-2`, `pi-3`); finished runs fill the same kind of grid in `verdict`; every pane carries a reliable `pi#<task id> <slug>` label. Three follow-ups from the queue work ship with it: `/pi` rows in template step order, a glyph for pueue's Stashed state, and an exit file only the right pane-run can write.

## Decisions (from the grill, 2026-11-01)
- Beside Claude: at most 2 runs (`MAX_AGENTS = 2`). Claude keeps its 60% share. The runs' column is split evenly (50/50 with two).
- Overflow only: run 3 and later go to the `pi` tab. Running panes never move between tabs, and a freed slot beside Claude is filled only by the next new dispatch, never by promoting a run from the `pi` tab.
- Grid tabs (`pi*` and `verdict*`): columns = `min(3, floor(width / MIN_AGENT_WIDTH))`, filled row-major, every tile equal. Cap 6 tiles per tab; the 7th opens `pi-2` (or `verdict-2`), and so on.
- Even sizes come from herdr's socket `layout.set_split_ratio` (or `layout.apply`) at `$HERDR_SOCKET_PATH`, not from repeated halving.
- Rebalance: `pi-view` rebalances the tabs a pane enters and leaves; `pi-pane-run` rebalances its tab after it closes its own pane; a hand-closed pane is rebalanced lazily on the next add, or by prefix + `=` (`pi-layout rebalance`).
- Zoom: prefix + `z` toggles herdr's pane zoom. No focus-event daemon.
- Labels: `pi#<task id> <slug>` on every pane, kept across moves to `verdict`. Tab labels carry no task ids.

## Acceptance Criteria
- AC-1: At most 2 agent panes go beside Claude; a 3rd dispatch is placed in a grid tab
  verify: `node --test --test-name-pattern="third run goes to the pi tab" scripts/pi-layout.test.mjs`
- AC-2: The two panes beside Claude split their column evenly, and Claude keeps at least 60%
  verify: `node --test --test-name-pattern="side column is even" scripts/pi-layout.test.mjs`
- AC-3: The grid plan for n tiles uses min(3, floor(width / MIN_AGENT_WIDTH)) columns, row-major, all tiles equal within one cell
  verify: `node --test --test-name-pattern="grid plan" scripts/pi-layout.test.mjs`
- AC-4: The 7th pane in a grid tab goes to the next tab in the series (`pi` → `pi-2`, `verdict` → `verdict-2`)
  verify: `node --test --test-name-pattern="grid overflow names the next tab" scripts/pi-layout.test.mjs`
- AC-5: Placement never moves a running pane to another tab, and a freed side slot takes only a new dispatch
  verify: `node --test --test-name-pattern="running panes stay put" scripts/pi-layout.test.mjs`
- AC-6: `pi-layout rebalance <tab id>` turns a layout's split tree into the set-split-ratio calls that make every tile even
  verify: `node --test --test-name-pattern="rebalance ratios" scripts/pi-layout.test.mjs`
- AC-7: The `verdict` tab uses the same grid and rebalances when a pane is moved in
  verify: `rg -q 'pi-layout\.mjs.* rebalance' scripts/pi-view`
- AC-8: `pi-pane-run` rebalances its tab after it closes its own pane
  verify: `rg -q 'rebalance' scripts/pi-pane-run`
- AC-9: herdr binds prefix + `z` to pane zoom toggle and prefix + `=` to the rebalance command
  verify: manual - herdr key-binding syntax is checked live; confirm both keys work in a pi tab
- AC-10: A pane label falls back to the slug when the pueue lookup misses, and is never blank or `pi#0`
  verify: `node --test --test-name-pattern="label falls back to the slug" scripts/pi-pane-label.test.mjs`
- AC-11: A pane moved to `verdict` keeps its `pi#<id> <slug>` label
  verify: manual - herdr rename state across `pane move` is observed live
- AC-12: `/pi` lists a queue's rows in template step order, not task id order
  verify: `claude plugin test /Users/vietquocbui/dotfiles/.claude/worktrees/jj-wt/session-band-plugin 2>&1 | rg -q "\(pass\) queue rows follow template step order"`
- AC-13: pueue's Stashed state parses as its own state and shows a glyph, not `?`
  verify: `claude plugin test /Users/vietquocbui/dotfiles/.claude/worktrees/jj-wt/session-band-plugin 2>&1 | rg -q "\(pass\) stashed tasks get their own glyph"`
- AC-14: Only the pane-run that `pi-view` started can write a run's exit file: a pane-run without the run's token leaves it alone
  verify: `node --test scripts/pi-pane-run.test.mjs`
- AC-15: Live check: 3 dispatches give 2 even panes beside Claude and 1 in `pi`; finishing one fills `verdict` evenly
  verify: manual - visual check in herdr
- AC-16: Existing script tests still pass
  verify: `node --test scripts/*.test.mjs`
  baseline: pass
- AC-17: Existing session-band plugin tests still pass
  verify: `claude plugin test /Users/vietquocbui/dotfiles/.claude/worktrees/jj-wt/session-band-plugin`
  baseline: pass

## Boundaries
### Always
- Keep `placePane` and the grid and rebalance planners pure and tested; only the CLI layer talks to herdr
- Fall back to the `pi` tab on any herdr failure, as today
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- New dependencies; a long-lived process or event subscriber
- Changes to gate code (agent-review, ac-run, pueue-safe, the reference-transaction hook)
### Never
- Move a running pane between tabs
- Edit a verify line or a test to make a check pass
- Push to main, merge, approve the spec or a review, force-push

## Open Questions
- Stashed glyph? Default: `◇` in the monitor and pane views, `…` in the compact band, tone yellow like Queued.
- Where does the run token live? Default: `pi-view` writes a random token into the run dir and passes it to `pi-pane-run` as a new first argument; `pi-pane-run` writes the exit file only when the token file still matches.
- Step order source for `/pi`? Default: the template definition next to `scripts/pi-queue`, matched by the `q:<run>:<template>:<step>` label; unknown steps sort last by task id.
- Is prefix + `=` free in herdr's defaults? Default: yes; if not, pick prefix + `E` and note it.
- Grid fill for a narrow `verdict` tab with 1 column? Default: the formula holds (1 column, up to 6 rows, subject to `MIN_AGENT_HEIGHT`; below that, overflow to the next tab).
