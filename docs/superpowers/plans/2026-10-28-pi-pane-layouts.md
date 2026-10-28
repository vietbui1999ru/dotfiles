# Pi pane layouts beside Claude, and a verdict tab

## Goal

Dispatched Pi panes open in the dispatcher's own herdr tab, beside Claude, instead of in a separate `pi` tab the person has to switch to. They follow one of a few named layout templates, the same way the person splits panes by hand with `prefix+v` (right) and `prefix+-` (down).

Finished implementation runs move out of the way into a `verdict` tab. There they wait for the person, or Claude, to close them, steer them or request edits. The session-band Pi hand-off pane gets matching controls.

## Decisions (made with the person, 2026-10-28)

- **Templates** are chosen with `PI_VIEW_LAYOUT=auto|side|below|tab`. The default is `auto`.
  - `side`: the first agent pane splits Claude's pane to the right, and Claude keeps about 60%. Further agent panes stack downward in that right column.
  - `below`: the first agent pane splits Claude's pane downward, and Claude keeps about 60%. Further agent panes line up left to right in that bottom row.
  - `tab`: today's behaviour, a separate `pi` tab.
  - `auto`: `side` when the tab is at least 160 columns wide, otherwise `below`.
- **At most 3 agent panes beside Claude.** A 4th dispatch, or a pane that would fall below the minimum size, overflows into the `pi` tab. The minimum size is 40 columns and 8 rows for an agent pane, and Claude keeps at least 60 columns (side) or 12 rows (below).
- **Read, explore, research and review runs** (plain `pi-view` and `--live`) never auto-close and never move.
- **Implementation runs (`--tui`)** move to the workspace's `verdict` tab when they finish, freeing their slot beside Claude. In that tab the person can steer or request edits in Pi, or Claude can close or edit them. A run counts as finished when its pane's herdr `agent_status` has been `idle` or `done` for 15 s and the pane isn't focused. It moves at most once per run, and a run already in `verdict` stays there.
- **Pane mode** (`scripts/pane-handoff`) stays as it is.

## Facts this plan relies on (checked 2026-10-28, herdr 0.9.5)

- **`herdr pane layout --current`** returns `result.layout.area` (`width`, `height`) and `panes[]`, each with `pane_id` and `rect` (`x`, `y`, `width`, `height`), plus `splits[]` and `tab_id`.
- **pueue tasks capture the dispatcher's environment,** so `pi-view` gets the dispatcher's `HERDR_PANE_ID`, which is Claude's pane, and `HERDR_WORKSPACE_ID`. Claude's pane is the anchor.
- **`herdr pane split <pane> --direction right|down --ratio <f> --no-focus`** splits a pane. Verify in Step 0 which side `--ratio` sizes.
- **`herdr pane move <pane> --tab <tab> --split right|down --target-pane <id> --no-focus`** moves a pane, and **`herdr pane move <pane> --new-tab --workspace <ws> --label <text> --no-focus`** creates a tab while moving. Checked live: the pane keeps its id, and the process running in it survives the move. So a `--tui` Pi keeps running, TUI and all, when moved.
- **`pane list` does not return pane labels,** so `pi-view` has to keep its own record of which agent panes it opened.
- **herdr focus commands:** `herdr agent focus <target>` and `herdr tab focus <tab>` exist. Directional `pane focus` is not enough to jump to a given pane.

## Step 0: verify (stop and report if wrong)

1. Which side `--ratio` sizes in `pane split`, the existing pane or the new one. Check with `herdr pane layout` after a split.
2. That `herdr agent focus <pane id>` focuses a given pane even in another tab. If it doesn't, find the command that does (`herdr agent focus --help`).

Use scratch panes and close them afterwards.

## Step 1: `scripts/pi-layout.mjs`, a pure placement function and a small CLI

- **`placePane({ layout, area, anchor, agents, max = 3 })`** returns one of:
  - `{ kind: "split", target, direction, ratio }`;
  - `{ kind: "tab" }`.

  The inputs:
  - `layout`: `auto`, `side`, `below` or `tab`;
  - `area`: the tab size;
  - `anchor`: Claude's pane rect;
  - `agents`: the rects of this tab's live agent panes, in the order they were opened.

  The rules come from the Decisions section. `auto` resolves by width. The first agent splits the anchor. Later agents split the last agent: `down` for side, `right` for below, with the ratio that gives the column or row equal shares. Overflow on count or size returns `{ kind: "tab" }`.
- **CLI:** `node scripts/pi-layout.mjs <layout> <anchor pane id> <agent pane ids…>` reads `herdr pane layout --pane <anchor>` itself and prints the decision as JSON. Agent ids that aren't in the anchor's tab, because they were closed or moved, are ignored.
- **Tests:** `scripts/pi-layout.test.mjs` (`node --test`). Cover, for each template:
  - the first pane, the second, the third, and overflow at the 4th;
  - overflow on minimum size in a small tab;
  - `auto` at 159 and at 160 columns;
  - `tab` always returning `tab`.

## Step 2: `pi-view` places panes with the template

- **Opening.** In `open_pane`, when `HERDR_PANE_ID` is set and `PI_VIEW_LAYOUT` isn't `tab`, ask `pi-layout.mjs` for a decision. Use the record at `$TMPDIR/pi-view/tab-<anchor tab id>.panes` (one pane id per line, pruned of panes that no longer exist) as the agent list.
  - On a `split` decision, split as told, then append the new pane id to the record.
  - On a `tab` decision, or when any herdr call fails, fall back to today's `pi` tab code.

  Keep the existing lock around the whole decide-and-split step, so parallel dispatches don't pick the same slot.
- **The pane file.** Write `$TMPDIR/pi-view/<session-id>.pane` containing the pane id, for every mode (plain, `--live`, `--tui`), so the session-band mod can find a run's pane. Remove it when the run ends, except in `--tui`, where Step 3 handles it.
- **Plain and `--live` runs** behave exactly as now after the pane opens. They never close or move.

## Step 3: `--tui` runs move to the `verdict` tab when finished

- **In the wait loop** (where `pi-view --tui` waits for the exit file), also read `herdr pane get <pane>` each time round. Once `agent_status` has been `idle` or `done` for 15 s in a row and the pane isn't focused, move it into the workspace's `verdict` tab:
  - if the tab doesn't exist yet, create it with `pane move … --new-tab --workspace <ws> --label verdict --no-focus`;
  - if it exists, `--split down` under its last pane.
- **Bookkeeping.** Remove the pane from the tab record, so its slot beside Claude frees up. Send `herdr notification show "pi#<task or session id> ready for verdict"`. Move at most once.
- **Then** keep waiting for the exit file as now. The person or Claude ends the run by quitting Pi, by `pueue kill`, or through the mod's controls.

## Step 4: session-band Pi hand-off pane controls for `--tui` runs

In `session-band-plugin/hooks/`:

- **A run is a `--tui` run** when its pueue command contains `pi-view --tui` (a small helper next to `parsePiCommand`). Its pane id comes from `$TMPDIR/pi-view/<session id>.pane` through `$.fs.read`.
- **New controls** for the selected task when it's a running `--tui` run with a known pane:
  - **Focus** (hotkey `o`): runs the Step 0 focus command on that pane.
  - **Close**: sends `ctrl+d` to the pane (`herdr pane send-keys <pane> ctrl+d`), which quits Pi and so ends the task. If the task is still running 5 s later, fall back to the existing kill path.
  - **Continue:** for these runs, the existing Continue input sends the text into Pi's TUI (`herdr pane send-text <pane> <text>`, then `send-keys <pane> Enter`) instead of starting a new dispatch. Pi takes it as a steer while working, or a new prompt while idle. Other runs keep today's Continue.
- **Monitor row.** Show where the pane is (`beside`, `verdict` or `pi tab`), from the pane's tab label and whether it's in the dispatcher's tab.
- **Tests,** next to `pane-controls.test.ts` and `pane.test.ts`, using the fake pueue:
  - Continue routes to `send-text` for a `--tui` task and to the old path otherwise;
  - Close sends `ctrl+d`;
  - the controls only appear for running `--tui` tasks with a pane file.

  Add tests only; edit no existing test.

## Step 5: docs

- **`shared/skills/delegate-pi/SKILL.md`,** in the `pi-view` paragraphs: `PI_VIEW_LAYOUT` and its templates, the 3-pane limit and overflow, `verdict` for finished `--tui` runs, and the mod's Focus, Close and Continue.
- **`README.md`:** one line under the Pi section.

## Out of scope

- Remembering a template per project, and resizing existing panes when a new one opens.
- Moving read, explore and review panes anywhere.
- Changing pane mode.

## Verification

- `node --test scripts/pi-layout.test.mjs scripts/pi-tail.test.mjs scripts/pi-live.test.mjs` passes.
- `zsh -n scripts/pi-view scripts/pi-pane-run` is clean.
- `cd session-band-plugin && claude plugin test .` passes.
- **Live, run by Claude after Pi finishes:**
  - with `PI_VIEW_LAYOUT=side` and then `below`, three dispatches from Claude's pane open beside it in the template's shape, and a 4th goes to the `pi` tab;
  - a finished `--tui` run moves to `verdict`, keeps running, and frees its slot;
  - the mod's Focus jumps to it, Continue reaches Pi's TUI, and Close ends the task.
- Paste the output of every command in the final report.

## Commit and review

Commit each step separately with the commit funnel. Do not edit `agent-review`, `post-run-verifier` or `pi-lens`.
