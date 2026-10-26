# herdr viewer panes for dispatched Pi tasks

## Goal

When a Pi task that was dispatched through pueue starts running, a herdr pane opens in a tab named `pi` in the dispatcher's herdr workspace. The pane shows that task's live transcript (thinking, turns, tool calls), and herdr's sidebar shows the pane as `working` and then `done`. The session-band pane and band go on tracking the task exactly as they do now.

Pueue stays the only place work runs and the only source of truth. The herdr panes display the work and nothing else: closing one, or a re-layout, never touches the task.

## Facts this plan relies on (checked on 2026-10-26, herdr 0.9.5, node v24.22.0)

- **Pueue captures the environment of the shell that ran `pueue add`.** Task 158 holds 95 variables. A task added from a herdr pane therefore carries `HERDR_ENV`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID` and `HERDR_PANE_ID`. A task added from outside herdr carries none of them.
- **Pi's herdr extension is off in print mode.** `~/.pi/agent/extensions/herdr-agent-state.ts:229-232` returns unless `ctx.mode === 'tui'`. `pi -p` runs therefore report nothing to herdr on their own, so the wrapper has to report state itself.
- **A wrapper prefix keeps session-band working:**
  - `parsePiCommand` (`session-band-plugin/hooks/pueue.ts:107`) takes the first word equal to `pi` or ending in `/pi`.
  - `isPiDispatch` (`pueue.ts:82`) matches a standalone `pi` word anywhere in the command.
  - The tracker (`hooks/handoff.tsx`, `tool.call` hook) only needs `pueue add` in the Bash command and `--model` in the task command.
  - Edit's re-add (`lifecycle.ts:54`) reuses the task command, so the wrapper is kept.
  - The wrapper must therefore not be named `pi` or end in `/pi`.
- **Node 24 can import the parser directly.** `import('./session-band-plugin/hooks/pisession.ts')` works and exports `emptyProgress`, `fold`, `sessionDir` and `sessionFileName`, so `pi-tail` can use the same parser as the pane.
- **The herdr CLI has what the wrapper needs.** It has `tab list`, `tab create --workspace --label --no-focus --cwd`, `pane split --direction down --no-focus --cwd`, `pane run`, `pane report-agent --source --agent --state --message --seq`, and `pane list`. Each command returns JSON shaped `{ "result": { ... } }`. `tab list` gives `tab_id`, `label`, `pane_count` and `workspace_id` per tab.
- **macOS `date` has no `%N`.** Do not build `--seq` from nanoseconds. Each viewer pane is new, so `--seq 1` for `working` and `--seq 2` for the final state is enough.

## Step 0: verify these before writing code, and stop and report if any is wrong

1. The JSON that `herdr tab create … --no-focus` returns, and how to get the id of the new tab's first pane. Either the create result gives it, or `herdr pane list` can be filtered by `tab_id`.
2. That `herdr pane run <pane> "<cmd>"` starts the command in an unfocused pane of an unfocused tab.
3. That `report-agent` accepts a custom source on a pane whose foreground process is not an agent. Try `--source custom:pueue --agent pi --state working --seq 1` on a scratch pane, then check `herdr pane get`. If `custom:` is refused, read `herdr pane report-agent --help` for the accepted source format.
4. Whether node 24 prints an ExperimentalWarning when it imports a `.ts` file. If it does, launch `pi-tail` with `node --no-warnings`.

Remove any scratch panes and tabs when you are done.

## Step 1: `scripts/pi-tail.mjs`, the live transcript renderer

Usage: `node scripts/pi-tail.mjs --session-id <id> --cwd <dir> [--thinking]`

- **Finding the file.** Import `fold`, `emptyProgress`, `sessionDir` and `sessionFileName` from `../session-band-plugin/hooks/pisession.ts`. The session file lives at `$HOME/.pi/agent/sessions/<sessionDir(cwd)>/` and is the file whose name matches `sessionFileName(id)`. Poll once a second until it exists, printing `waiting for <id>…` once.
- **Reading new data.** Once the file exists, keep a byte offset. Each second, read only the bytes past that offset with `fs.open` and `read`. Hold back any trailing partial line until it is complete. Pass only complete lines to `fold(emptyProgress(), chunk)` and print the entries that come back. Each chunk's entries are new, so there is no need to diff against the 200-entry cap.
- **Rendering.** Export a pure `render(entry, showThinking)` that returns printable lines and mirrors `transcriptLines` in `session-band-plugin/hooks/pane.tsx:399`. Copy the five entry kinds and their prefixes (`  · `, `ERROR `, `  ↳ `, text cut to 280 characters). Do not import `pane.tsx`: it pulls in the plugin runtime.
- **Running.** Run until killed. Ctrl+C exits cleanly.
- **Tests.** Add `scripts/pi-tail.test.mjs` (`node --test`, the style of `scripts/herdr-sketchybar-label.test.mjs`). Cover:
  - `render` for each entry kind, with thinking shown and hidden;
  - the partial-line handling, as a pure helper `splitComplete(buffer) -> { lines, rest }`.

## Step 2: `scripts/pi-view`, the wrapper used as the pueue task command's prefix

Usage, inside the pueue task: `$HOME/dotfiles/scripts/pi-view pi --model … --session-id pueue-<slug> -p "…" < /dev/null`

Write it in zsh, with `set -u`, as in the other scripts. Behaviour:

1. **Outside herdr, change nothing.** If `HERDR_ENV` is not `1`, or `herdr` is not on PATH, or the arguments contain no `--session-id`, run `exec "$@"`.
2. **Open a viewer pane.** In `$HERDR_WORKSPACE_ID`:
   - find the tab labelled `pi` (`herdr tab list` plus `jq`);
   - if there is none, `herdr tab create --workspace "$HERDR_WORKSPACE_ID" --label pi --no-focus --cwd "$PWD"` and use its first pane;
   - if it exists, split the last pane of that tab: `herdr pane split <pane> --direction down --no-focus --cwd "$PWD"`.
3. **Start the viewer.** Run `herdr pane run "$P" "node $HOME/dotfiles/scripts/pi-tail.mjs --session-id <id> --cwd $PWD"`.
4. **Report working.** `herdr pane report-agent "$P" --source <from step 0> --agent pi --state working --message "pi#$PUEUE_TASK_ID" --seq 1`. Use the task id only if pueue exposes one in the environment; otherwise give the session id.
5. **Run Pi.** Run Pi without the herdr pane variables: `env -u HERDR_PANE_ID "$@"`. Save its exit code in `rc`. Do not `exec` here: the final report still has to run.
6. **Report the end state.** If `rc` is 0, report `done` with the message `exit 0`; otherwise report `blocked` with the message `exit $rc`. Use `--seq 2`.
7. **Exit with Pi's code.** `exit $rc`. Pueue, agent-review and session-band all read the exit code.

Two rules for every herdr call:
- **It may never fail the task.** Add `|| true`, and keep its output off the task's stdout, so `pueue log` stays Pi's output.
- **If any herdr call before step 5 fails,** skip the rest of the herdr work and still run Pi.

There is no automated test for `pi-view`: it is a thin layer over the herdr CLI. Check it with `zsh -n scripts/pi-view` and the live check below.

## Step 3: guard tests in session-band (add only; edit no existing test)

In `session-band-plugin/hooks/handoff.test.ts`, add one test asserting the following for `"$HOME/dotfiles/scripts/pi-view" pi --model opencode-go/x:high --session-id pueue-a -p "$(cat /tmp/p)" < /dev/null`:
- `isPiDispatch(...)` is `true`;
- `parsePiCommand(...)` returns the model `opencode-go/x`, the effort `high` and the session id `pueue-a`;
- `trackedFrom` adopts a task with that command.

If any assertion fails, report it. Do not change parsing code to make it pass.

## Out of scope

- **The dispatch rules.** Changing the dispatch command in `shared/skills/delegate-pi/SKILL.md` and `claude/.claude/rules/plan-handoff.md` to add the `pi-view` prefix is done by Claude after this plan's review, not by Pi.
- **Continue.** The pane's Continue builds a new command with `dispatchCommand` (`pueue.ts`), so continued runs get no viewer. Follow up only if wanted.
- **Closing viewer panes.** Panes are not closed automatically. The user closes them. Revisit if the `pi` tab fills up; it gets hard to read beyond about 6 panes.
- **Queue counts in the herdr sidebar** (`workspace report-metadata`). This is a separate small change.

## Verification

- `node --test scripts/pi-tail.test.mjs` passes.
- `cd session-band-plugin && claude plugin test .` passes, including the new guard test.
- `zsh -n scripts/pi-view` is clean.
- **Live check.** From a Claude session inside a herdr pane, dispatch two short Pi tasks with the `pi-view` prefix and `--session-id pueue-<slug>`. Confirm that:
  - a `pi` tab appears with one viewer pane per task, each streaming its transcript;
  - herdr's sidebar shows each pane as `working`, then `done`;
  - the session-band pane and band still list both tasks;
  - `pueue log` shows Pi's output and no herdr output.
- **Outside herdr.** Dispatch one task from a shell that is not in herdr. It must run exactly as before, with no pane and no errors.
- Paste the output of every command above in the final report.

## Commit and review

Commit each step separately with the commit funnel. Do not edit `agent-review`, `post-run-verifier` or `pi-lens`.
