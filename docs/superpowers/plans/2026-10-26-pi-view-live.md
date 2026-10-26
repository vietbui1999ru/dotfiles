# pi-view --live: steerable Pi dispatches

## Goal

A dispatched Pi run that can be steered while it works. The person types into the run's herdr viewer pane, or Claude sends a message from the main pane, and Pi reads it between turns. Pueue still owns the process, so `pueue kill` (session-band's `x`, or Claude) still ends the run, and closing a viewer pane still only closes the view. The session file, `pi-tail`, the session-band pane and its `v` view keep working unchanged.

`--live` is opt-in. Plain `pi-view` dispatches behave exactly as they do now. If `--live` proves itself, it can replace pane mode (`scripts/pane-handoff`), which is kept until then.

## How it works

- `pi-view --live pi --model … --session-id pueue-<slug> -p "<prompt>" < /dev/null` keeps today's command shape, so session-band's `parsePiCommand` and `isPiDispatch` (which needs `-p`) still recognise it.
- Instead of running the arguments directly, `pi-view` hands them to a new node driver, `scripts/pi-live.mjs`. The driver:
  - runs Pi as `pi --mode rpc` without `-p`;
  - sends the `-p` text as the first `prompt` command;
  - owns Pi's stdin and reads Pi's stdout.
- **Ways in.** A FIFO at `$TMPDIR/pi-view/<session-id>.in` (mode 0600) takes one message per line. Both the viewer pane and `scripts/pi-steer` write to it.
- **What a line becomes:**
  - while Pi is working: a `steer` command, delivered after the current turn's tool calls and before the next model call;
  - while Pi is idle: a `prompt` command, which starts a new run;
  - `/abort`: an `abort` command, which stops the current turn and keeps the session;
  - `/done`: the driver ends the session now.
- **Ending the session.** Pi in RPC mode does not exit by itself.
  - After Pi's `agent_settled` record, the driver waits a grace period of `GRACE_SECONDS = 120`.
  - Any `agent_start` (for example a post-run-verifier repair turn) or new typed input cancels the wait.
  - When the wait runs out, or on `/done`, the driver closes Pi's stdin, and Pi shuts down in an orderly way.
- **Notices.** Pi's `extension_ui_request` records with method `notify` (for example agent-review refusing input while a review is pending) are appended to `$TMPDIR/pi-view/<session-id>.notes`. `pi-tail` shows that file in the pane.
- **Dialogs** (`select`, `confirm`, `input`, `editor`) are answered with `{"type":"extension_ui_response","id":…,"cancelled":true}`, and a note is written, so Pi never stalls waiting for an answer nobody can give.

RPC record names are from the installed Pi docs: `docs/rpc-commands.md`, `docs/json.md` and `docs/rpc-extension-ui.md` under `/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/`.

## Step 0: spike (Claude runs this, not Pi; stop if any check fails)

Claude runs this, because a Pi build run would have to start a nested RPC Pi in its own worktree, and the nested run's agent-review snapshot would collide with the outer run's review. Run it in a scratch worktree created from `main` for the purpose. Drive `pi --mode rpc` directly from a small throwaway script in `$CLAUDE_JOB_DIR/tmp`, using the low tier (`opencode-go/deepseek-v4.1-flash:off`) and a fresh `--session-id pueue-spike-<hex>`.

1. **Session file.** With every extension loaded, RPC mode writes `~/.pi/agent/sessions/<sessionDir(cwd)>/…_pueue-spike-<hex>.jsonl`. That is, `--session-id` is honoured in RPC mode, and `pi-tail` can tail the file.
2. **Steer delivery.** Send a `prompt` that needs at least two tool calls, then a `steer` while it streams. The steer appears in the session file as a user message before the next assistant turn, and Pi acts on it.
3. **Idle and settle order.** Record the stdout record sequence at the end of a run: `agent_end`, then `agent_settled`, and whether post-run-verifier starts another `agent_start` afterwards. This decides that the grace timer starts on `agent_settled` and is cancelled by `agent_start`.
4. **agent-review between runs.** Make the first run edit one scratch file, so a review becomes pending. Then send a second `prompt` and record:
   - whether it is refused;
   - what record carries the refusal (expected: a `notify` request, from `agent-review/index.ts:548-556`);
   - whether agent-review's approval follow-up (`sendFollowUp`) later arrives in the same RPC session.

   **Do not approve or skip the review.** Report its run id for the person to decide.
5. **Dialogs.** List every `extension_ui_request` method seen across checks 1-4, and which extension sent each one.
6. **Shutdown.** Close stdin. Record Pi's exit code, and whether it differs when the last run was aborted or failed. This decides the driver's exit code rule.

Write the findings into this plan under a "Spike results" heading and commit them. If check 1 or check 2 fails, `--live` is not viable as designed: stop and report. Otherwise adjust Steps 1-4 to what the spike found, then dispatch Steps 1-5 to Pi.

## Spike results (2026-10-26, Claude, scratch worktree `spike-pi-live-bb3478bf`)

All six checks ran against `pi --mode rpc` with every extension loaded, on `opencode-go/deepseek-v4.1-flash:off`. The design holds; Step 1 is adjusted below.

1. **Session file: pass.** `…/--Users-vietquocbui-dotfiles-.claude-worktrees-spike-pi-live-bb3478bf--/2026-10-26T10-51-47-012Z_pueue-spike-bb3478bf.jsonl` was written. Pi prints `Warning: No project session found with id …; creating a new session with that id.` to stderr. It is harmless and lands in `pueue log`.
2. **Steer: pass.**
   - A `steer` sent at the first `tool_execution_start` was answered `{"command":"steer","success":true,"data":{"disposition":"queued"}}`, together with a `queue_update`.
   - It appears in the session file as a user message after that turn's tool results and before the next assistant turn.
   - The final reply ended with `STEERED`, as the steer asked.
3. **Settle order: `turn_end`, then `agent_end`, then `agent_settled`,** a few milliseconds apart. post-run-verifier ran inside the run, before `agent_end` (its `notify` "verification skipped: 0 passed, 0 failed, 4 skipped" came first). No `agent_start` followed either settle within 20-25 s. So the grace timer starts on `agent_settled`. Cancelling it on `agent_start` stays as a safeguard.
4. **agent-review between runs.**
   - Run A, which made no edits, left no review.
   - Run B wrote `spike-note.txt`, which left review `d20e0446-f6fe-4a97-bbad-3c38a35225bf` pending. That review is left for the person: not approved, not skipped.
   - The third `prompt` was **not rejected**. It came back `{"success":true,"data":{"disposition":"handled"}}`, preceded by an `extension_ui_request` `notify` reading "Review pending (d20e0446-…) — /review skip review to continue". No run started.
   - Whether agent-review's approval follow-up then arrives in the same RPC session was not observed, because the review was left pending and the session was closed.
5. **Dialogs: none.** The only `extension_ui_request` methods seen were:
   - `setStatus`, many, from the review gate's status updates;
   - `setWidget`, with key `subagent-async`, from pi-subagents;
   - `notify`, from post-run-verifier and agent-review.

   No `select`, `confirm`, `input` or `editor` request appeared. Cancelling dialogs stays as a safeguard.
6. **Shutdown.** Closing stdin made Pi exit with code 0 about 180 ms later, even with a review pending. In RPC mode the exit code does not report a refused input, because agent-review's print-mode failure applies only to `-p`.

## Step 1: `scripts/pi-live.mjs`, the RPC driver

Usage, from `pi-view` only: `node scripts/pi-live.mjs -- pi --model … --session-id <id> -p "<prompt>"`

- **Arguments.** Take the `-p` (or `--print`) value out of the arguments, and add `--mode rpc`. Keep every other argument as it is. Spawn Pi with `stdin` piped, `stdout` piped, and `stderr` inherited, so it lands in `pueue log`. Spawn it without `HERDR_PANE_ID`, as `pi-view` does now.
- **The FIFO.** Create it with `mkfifo -m 600` under `$TMPDIR/pi-view/`. Open it read-write, so it never reports end-of-file when a writer disconnects. Remove it and the `.notes` file on exit.
- **The state machine** is a pure, exported `nextAction(state, event) -> { state, commands[], close? }`, with no I/O, unit-tested. States: `working` and `idle`. Events: an input line, `agent_start`, `agent_settled`, the grace timer firing, and an `extension_ui_request`.
- **Reading Pi's output.** Parse stdout as JSON lines. Pass `agent_start`, `agent_settled` and `extension_ui_request` to `nextAction`. Ignore the rest: the session file already has the transcript.
- **Refused input (spike check 4).** A `prompt` answered `success: true` with `disposition: "handled"` started no run. When a `notify` arrived just before it, write that notify to the notes file as the reason, and stay `idle`. Do not treat `success: true` as "a run started": only `agent_start` means that.
- **Status records.** Ignore `setStatus` and `setWidget` requests: they need no answer.
- **Exit code (spike check 6).** Exit 1 if the most recent prompt was refused as described above. Otherwise exit with Pi's code. This mirrors `-p` mode, where agent-review fails the run only when input is refused, not merely because a review is pending.
- **Tests.** `scripts/pi-live.test.mjs` (`node --test`). Cover:
  - argument rewriting (`-p` removed, `--mode rpc` added, nothing else changed);
  - steer while working and prompt while idle;
  - `/abort` and `/done`;
  - the grace timer starting on settle and being cancelled by `agent_start` and by input;
  - a dialog cancelled, with a note written;
  - a notify written to the notes file.

## Step 2: `pi-view --live`

- **The flag.** Accept `--live` as `pi-view`'s first argument and strip it before parsing the session id.
- **Inside herdr.** Open the viewer pane as now. Start `pi-tail` with `--input "$TMPDIR/pi-view/<session-id>.in"`. Run `node <dir>/pi-live.mjs -- "$@"` in place of `env -u HERDR_PANE_ID "$@"`. Keep the existing working, done and blocked reports.
- **Outside herdr.** With `--live`, still run `pi-live.mjs`, just without a pane, so `pi-steer` works from anywhere. Without `--live`, nothing changes: `exec "$@"`.
- **Help text.** Update the usage comment at the top of the script.

## Step 3: input in `pi-tail`, and the `pi-steer` script

- **`pi-tail --input <fifo>`.** Read lines typed in the pane with `node:readline` and write each one, newline-terminated, to the FIFO. If the FIFO no longer exists, print `session ended` and stop reading input.
- **The notes file.** Also tail `<session-id>.notes` next to the FIFO, and print each note as `NOTE <text>`.
- **Without `--input`,** `pi-tail` behaves exactly as now.
- **`scripts/pi-steer <session-id> <message…>`** (zsh). Write the joined message as one line to the FIFO. If there is no FIFO, exit 1 with `no live session <id>`. Claude uses this from the main pane.
- **Tests.** Add a `pi-tail.test.mjs` case for the input path, writing to a temporary FIFO. `pi-steer` gets `zsh -n` only.

## Step 4: guard test in session-band (add only; edit no existing test)

In `session-band-plugin/hooks/handoff.test.ts`, assert that `"$HOME/dotfiles/scripts/pi-view" --live pi --model opencode-go/x:high --session-id pueue-a -p "$(cat /tmp/p)" < /dev/null` is accepted by `isPiDispatch`, parsed by `parsePiCommand` (model, effort and session id), and adopted by `trackedFrom`. Report a failure; do not change the parsing code to make it pass.

## Step 5: docs

- In `shared/skills/delegate-pi/SKILL.md`, after the `pi-view` paragraph, add one paragraph covering:
  - `--live` for runs the person wants to steer;
  - typing in the viewer pane;
  - `pi-steer <session-id> "<message>"` from Claude;
  - `/abort` and `/done`;
  - the 120 s grace period, during which the task holds a pueue slot.
- Do not touch `claude/.claude/rules/plan-handoff.md`, pane mode, or the review gate files.

## Out of scope

- **session-band's Continue.** The pane's Continue input could call `pi-steer` for live tasks. Follow up only if wanted.
- **Retiring pane mode.** That is the person's call, after `--live` has run for real.
- **Images in steer messages.**

## Verification

- `node --test scripts/pi-live.test.mjs scripts/pi-tail.test.mjs` passes.
- `zsh -n scripts/pi-view scripts/pi-steer` is clean.
- `cd session-band-plugin && claude plugin test .` passes, including the new guard test.
- **Live check, run by Claude after Pi finishes.** From a herdr pane, dispatch a `--live` run whose prompt needs several tool calls. Confirm that:
  - text typed in the viewer pane mid-run shows up as a steer in the transcript, and Pi follows it;
  - `pi-steer` from the main pane does the same;
  - `/abort` stops the current turn;
  - after Pi settles, the pane accepts a new prompt within the grace period;
  - the session closes about 120 s after the last settle, herdr shows `done`, and pueue shows the task finished;
  - `pueue kill` on a second live run ends it, and herdr shows `blocked`.
- **Plain dispatch.** A dispatch without `--live` behaves exactly as before.
- Paste the output of every command above in the final report.

## Commit and review

Commit each step separately with the commit funnel. Do not edit `agent-review`, `post-run-verifier` or `pi-lens`.
