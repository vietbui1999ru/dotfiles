# Phase 2: Approve/Deny prompt for specs in the session-band mod

Part of `docs/plans/2026-11-05-band-only-approval.md`. Phase 1 (#250, merged) gave `scripts/spec` a
dialog-free `approve` and a ready marker. This phase makes the session-band mod ask the person to
Approve or Deny each ready spec, the same way blast radius asks about a risky Bash command.

Work only inside `session-band-plugin/`. Do not edit anything under `scripts/`, `claude/`, `pi/` or
`nvim/`. Commit as you go with clear messages.

## What phase 1 provides (read `scripts/spec` to confirm, do not change it)

- A clean `spec lint` of a draft writes `~/.local/state/ac-run/ready/<hash>.json`:
  `{"spec": "<absolute path to SPEC.md>", "rel": "...", "branch": "...", "hash": "...", "ts": "..."}`.
- `spec approve <path>` no longer asks anything. It runs every verify command once for a baseline,
  writes the approval record, sets `status: approved`, and deletes the marker.
- `spec reject <path>` sets `status: draft` and deletes the marker.
- `spec show <path>` prints the summary (one `runs:` line per verify command) and changes nothing.

## Task 1: `hooks/spec-ready.ts` (pure helpers, no `$`)

- `READY_DIR = (home) => `${home}/.local/state/ac-run/ready``.
- `parseMarker(text): { spec, rel, branch, hash } | undefined`. Return undefined on bad JSON, or if
  `spec` or `hash` is missing or not a string.
- `askText(marker, summary)`: the summary capped at 40 lines (add `… N more lines` when cut), then a
  blank line, then `Approve this spec?`.
- `dirOf(path)` returns the parent directory of an absolute path (the cwd for `spec` commands).
- Tests in `hooks/spec-ready.test.ts` cover all four.

## Task 2: `hooks/spec-ready.tsx` (the prompt)

Model it on `hooks/blast.tsx:129-160` (`isInteractive`, `captureSession`, `$.ui.ask` with a
try/catch where a throw means dismissed) and on the `$.clock.every` timer in `hooks/lifecycle.tsx:63-64`.

- `let isInteractive = false`; export `captureSpecSession(interactive)`.
- `export const register: Register = on => { ... }`: on `session.start`, call `next(e)` first, then
  start `$.clock.every(SPEC_READY_MS, ...)` with `SPEC_READY_MS = 10_000`, swallowing errors the same
  way `lifecycle.tsx` does. Only start the timer when `isInteractive`.
- Each tick:
  - If a prompt is already open (a module `asking` flag), skip the tick.
  - `home = await $.env.get('HOME')`; list `READY_DIR(home)` with `$.fs.list` (a missing dir is empty).
  - Take the first `*.json` whose hash is not in the module `asked` Set. Read it with `$.fs.read`
    and `parseMarker`; on a bad marker, add it to `asked` and stop.
  - If `!(await $.fs.exists(marker.spec))`, add it to `asked` and stop.
  - `summary` = stdout of `$.process.run(specArgv(home, 'show', marker.spec), { cwd: dirOf(marker.spec) })`.
    On a failure or a non-zero exit, add the hash to `asked` and stop.
  - Set `asking = true`; `answer = await $.ui.ask(askText(marker, summary), ['Approve', 'Deny'])`.
    A throw means dismissed: add the hash to `asked`, do nothing else, and leave the marker so
    `/gates` still lists the spec. Always reset `asking` in `finally`.
  - Add the hash to `asked`. If the marker file no longer exists, another session already
    decided: `$.ui.toast('<rel>: already decided in another session')` and stop.
  - **Approve**: `$.process.run(specArgv(home, 'approve', marker.spec), { cwd, timeoutMs: approveTimeoutMs(count) })`,
    where `count` is the number of lines in `summary` whose trimmed start is `runs:`.
    This is the same rule as `hooks/gates.tsx:166`. Reuse `specArgv` and `approveTimeoutMs` from `hooks/gates.ts`.
  - **Deny**: `$.process.run(specArgv(home, 'reject', marker.spec), { cwd })`.
  - Toast the last non-empty line of stdout (or stderr). On a process error, toast
    `'<rel>: spec command failed or timed out'`.
- Wire it up in `hooks/register.tsx`:
  - import `captureSpecSession` and `register as registerSpecReady`;
  - call `registerSpecReady(on)` beside `registerGates(on)` (around :173);
  - call `captureSpecSession(e.isInteractive)` next to `captureSession(e.isInteractive)` at :185.

## Task 3: ask before approving in `/gates` and `/diff-review`

- `hooks/gates.tsx`, function `approve` (:146-178), spec branch only (the `else` at :163-169):
  - After `show` and before `spec approve`, ask
    `$.ui.ask(askText({rel: row.rel, ...}, detail), ['Approve','Deny'])`.
  - **Approve** runs the existing approve call.
  - **Deny** runs `specArgv(home, 'reject', row.path)` and sets the message from its output.
  - A throw (dismissed) sets the message to `'not approved'` and runs nothing.
  - Keep the busy claim and the `finally` exactly as they are.
- `hooks/review-pane.tsx`, spec branch at :402-407: before `spec approve`:
  - Run `spec show` and ask the same question.
  - **Deny** runs `spec reject`; a dismissal toasts `'not approved'` and returns.
- Leave every review-row (Pi run) path in both files unchanged. Phase 3 removes those.

## Task 4: tests (`claude plugin test .` in `session-band-plugin/`)

The baseline before this phase is 477 pass, 0 fail. Run the suite with `command claude plugin test .`:
plain `claude` is a zsh wrapper that is missing in non-interactive shells.

- New `hooks/spec-ready-prompt.test.ts`. Model the setup on `hooks/blast.test.ts:7-24`: answer
  `AskUserQuestion` from `tool.call`, use `mock.env` for HOME and `mock.clock`, and mock `fs.list`,
  `fs.read`, `fs.exists` and `process.run`. Cover:
  - Approve runs `spec approve <spec>` with cwd = the spec's dir and the baseline timeout.
  - Deny runs `spec reject`.
  - A dismissal runs neither, and the same hash is not asked again on the next tick.
  - A non-interactive session never asks.
  - A marker gone after the answer runs nothing and toasts "already decided".
  - A bad marker is skipped.
- `hooks/gates-pane.test.ts`: the tests at :150 ("gates approve runs in the spec worktree with
  baseline timeout"), :159 and :171 press `gates-approve` on spec rows. Their setup now has to
  answer the ask. Add an Approve answer to the shared setup at the top of the file, and keep the
  existing expectations.
  Add: a Deny on a spec row runs `spec reject`; a dismissal runs neither.
- `hooks/review-pane.test.ts`: update any spec-tab approve test the same way. Do not change the
  Pi-run approve tests (around :345).
- Never weaken an existing assertion to make it pass. If one conflicts with this plan, stop and
  report it.

## Done when

- `command claude plugin test .` passes, with more than 477 tests and 0 fail.
- `command claude plugin validate .` passes.
- Each task is committed separately on this branch.
