---
status: approved
branch: worktree-pueue-lifecycle-spec
---
# SPEC: Pueue lifecycle for Pi sessions

## Objective
The pueue daemon runs only while Pi work needs it. It starts on the first Pi dispatch, stops once no owner remains and the queue is empty, and never reports "workers aren't running" to a user who dispatched work. The `/pi` pane controls every pueue action.

## Acceptance Criteria
- AC-1: A Pi dispatch starts the daemon and the default group when they are down, then adds the task
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "dispatch starts a stopped daemon"`
- AC-2: A paused or zero-worker group is started before a dispatch, and the band shows one "not running" state for daemon-down, paused, and zero-worker alike
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "not running is one state"`
- AC-3: Each dispatching session is recorded as an owner, and `session.end` removes it
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "session end removes its owner"`
- AC-4: An owner whose process is no longer alive is dropped at the next check, so a crash cannot keep the daemon up
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "dead owner is pruned"`
- AC-5: The daemon shuts down only when no owner remains, the queue is empty, and 15 minutes have passed since the queue last emptied
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "idle window shuts the daemon down"`
- AC-6: A running task keeps the daemon up even when every owner has ended
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "running task keeps daemon up"`
- AC-7: A held (paused) queue counts as live, and the band shows "held N"
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "held queue counts as live"`
- AC-8: The `/pi` pane offers stop (pause the queue), kill (confirmed), remove, and edit (queued tasks only: model tier and label, done by remove and re-add)
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "pi pane offers stop kill remove edit"`
- AC-9: Kill leaves the worktree untouched and reports how many uncommitted changes it holds
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "kill reports uncommitted changes"`
- AC-10: Edit is refused for a running or finished task
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "edit refused unless queued"`
- AC-11: Existing plugin tests still pass
  verify: `claude plugin test session-band-plugin`
  baseline: pass
- AC-12: The plugin validates
  verify: `claude plugin validate session-band-plugin`
  baseline: pass
- AC-13: The `/pi` pane layout and key labels read clearly in the live band
  verify: manual - visual judgement in a live session

## Boundaries
### Always
- Stop a daemon only when no task is running or queued
- Refuse any pueue command with an empty id list (controls.ts already enforces this)
- Run `~/dotfiles/scripts/ac-run check SPEC.md` before claiming done
### Ask first
- Changing the 15-minute idle window
- Any change to pueue group defaults or worker counts
### Never
- Kill a running task without confirmation
- Discard or revert a worktree from the band
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Where does the owner state file live? Default: `$XDG_STATE_HOME/session-band/pueue-owners.json`, falling back to `~/.local/state/session-band/`.
- How does the daemon start? Default: `pueued -d`, the same command delegate-pi documents.
- Does `pueue kill` on a running task stop Pi's child processes? Default: yes, via the existing tree-kill in controls.ts; confirm during implementation.
