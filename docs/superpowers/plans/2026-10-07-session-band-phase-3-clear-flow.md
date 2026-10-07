# session-band phase 3: /clear auto-save

Date: 2026-10-07. Audience: Pi, building cold. Spec: `docs/superpowers/specs/2026-10-06-session-band-mod-design.md` (read "/clear" and "Risks and unknowns"). Phases 1 and 2 are merged: the plugin is `session-band-plugin/`, loaded through `CLAUDE_CODE_PLUGIN_DIRS`. Read `session-band-plugin/hooks/register.tsx` and `blast.tsx` first for house style, including how `blast.tsx` exports `register(on)` and `register.tsx` calls it.

## Goal

When the user runs `/clear` in a session that did real work, save a session summary first, then let the clear proceed. Never lose the context silently. This replaces the habit of running the `save-session` skill by hand before clearing. Nothing is retired in this phase.

## Already established, do not re-derive

- **The intercept works.** A live spike showed `on('command.run', { command: 'clear' }, ...)` fires on a typed `/clear` (`origin.kind` was `composer`, `args` was `""`). The matcher resolves aliases, so `/reset` and `/new` fold into `clear` too.
- **Not established: ordering.** The spike log line does not prove the hook runs before the transcript is wiped. Your code must read `$.session.messages()` first and treat an empty result with recorded real work as "wiped", see the fallback below. The live gate checks the ordering for real.
- **`command.run` shape.** Input `{ command, args, origin, presentation }`. `next(e)` runs the built-in clear and resolves `{ text?, context? }`. Returning your own `{ text }` **without** calling `next` refuses the clear and shows that text. `/clear` run by a plugin or headless (`origin.kind` not `composer`) must not hang waiting for a question: ask only for `composer`.
- **Transcript.** `await $.session.messages()` returns rows `{ role: 'user'|'assistant', text, toolUses[], toolResults? }`. A tool use summary carries the tool name and input; use it to list files edited. `await $.session.turns()` counts user prompts.
- **Summary generation.** `await $.model.complete({ model, prompt, system?, maxTokens, effort?, timeoutMs })` resolves `{ isAnswered: true, text, usage }` or `{ isAnswered: false, reason }`. It never rejects on a provider error: branch on `isAnswered`. Always pass `timeoutMs`.
- **Saving.** `agent-session` is at `/Users/vietquocbui/.local/bin/agent-session` (on PATH). `agent-session save --harness cc --goal "<goal>" --stdin` reads the body from stdin and writes `.agents/sessions/<timestamp>_cc_<work-type>_<slug>.md`. Run `agent-session save --help` first: the `save-session` skill says `--body -` but the CLI help lists `--stdin`; use what the help says. `agent-session path` prints the resolved sessions directory. `$.process.run(argv, { cwd, stdin, timeoutMs })` takes stdin.
- **Body format.** The sections the `save-session` skill uses: `## Completed`, `## In Progress`, `## Decisions Made`, `## Blocked / Needs Input`, `## Files Modified This Session`, `## Next Session Should`. The model prompt must demand exactly these headings.
- **Task worktrees.** A worktree with `.agent-task-id` writes `.agents/claimed/<TASK>.state.md` instead of a session file. `session-band-plugin/hooks/repo.ts` has `toRepoInfo(common, taskId)` returning `{ taskId, statePath }`; `register.tsx` and `blast.tsx` show how to gather the inputs (`git rev-parse --path-format=absolute --show-toplevel --git-common-dir`, then `$.fs.read` of `.agent-task-id`). Startup rules (`claude/.claude/rules/startup.md`) read `status: active` and `agent_task:` from that file's frontmatter, and `## In Progress` from the body. `$.fs.write(path, text)` exists.
- **`$` cannot cross an import and `$.op` cannot be passed as a value.** Pure logic goes in plain `.ts` files; every `$.process`, `$.fs`, `$.model`, `$.ui` call stays in `clear.tsx`. Phase 1 and 2 hit this.
- **`session.end` is not the place.** It also fires on `/clear` but under one short shared time bound that a model call would blow. Use `command.run`.
- **Harness quirk (Claude sessions only, not your code):** in a worktree-isolated session any Bash command text containing `git` is refused; run git as `/usr/bin/git`.

## Decisions (do not reopen)

1. **Files.** `hooks/clear.tsx` (`export const register: Register = on => ...`, hooks and all `$` calls), `hooks/summary.ts` (pure), `hooks/summary.test.ts`, `hooks/clear.test.ts`. Add `import { register as registerClear } from './clear'` and `registerClear(on)` to `register.tsx` next to `registerBlast(on)`.
2. **What counts as real work** (tracked by the module's own counters, not the transcript, because the transcript may already be wiped): at least one successful `Edit`, `Write`, `MultiEdit` or `NotebookEdit` (count after `next(e)` returns with no `deny`), **or** four or more `prompt.submit` events. Counters reset when a clear completes. Constants at the top of `summary.ts`.
3. **Flow.**
   1. Not real work: `return next(e)`.
   2. Real work, but a save landed in the last five minutes (latest file mtime in the sessions directory, or the task state file's mtime): skip the new save, `return next(e)`. The user already saved by hand.
   3. Read `$.session.messages()`. If it is empty while the counters say real work, the transcript is already gone: refuse with `{ text: 'Clear refused: the transcript is already gone, nothing to summarise. Run save-session first, or re-run /clear.' }` and do not call `next`. This is the gate fallback and is also the safe default if anything below is unexpectedly missing.
   4. Build a bounded digest from the messages (`summary.ts`): the first user prompt, the last 30 messages' text each cut to 600 characters, the list of files edited (from tool use inputs), and the failing tool results. Cap the whole digest near 30,000 characters.
   5. `$.model.complete({ model: 'sonnet', system, prompt, maxTokens: 2000, effort: 'low', timeoutMs: 60000 })`. The reply's first line is `GOAL: <one sentence>`; the rest is the body with the six headings. `summary.ts` parses it and returns nothing useful if the headings are missing.
   6. Save: orchestrator context runs `agent-session save --harness cc --goal <goal> --stdin` with the body on stdin and `cwd` the session root; capture the saved path from stdout if the CLI prints one (otherwise run `agent-session active` and use that). Task worktree: write the task state file with frontmatter `status: active` and `agent_task: <TASK>`, then the body.
   7. On success: `$.ui.toast('Session saved: <path>')`, then `return next(e)`.
4. **Any failure** (model not answered, parse failed, CLI exit non-zero, timeout, write error): `$.ui.ask('Save failed (<short reason>). Clear anyway?', ['Clear anyway', 'Cancel'])`. Only the exact label `Clear anyway` calls `next(e)`; `Cancel`, anything else, or a rejected ask returns `{ text: 'Clear cancelled: nothing was saved.' }`. If `origin.kind` is not `composer`, skip the question and refuse. Never clear silently after a failed save.
5. **Guard shape.** Register the `command.run` hook with the `.catch` form so a throw refuses rather than clears: `.catch(($, e, next) => next.called ? next(e) : { text: 'Clear cancelled: the save step failed.' })`. See the Agent guard in `register.tsx`.
6. **No model-writing files outside the CLI and the task state file.** Do not touch `.claude/session-state.md` directly; the CLI maintains that pointer.

## Work

All paths relative to the repo root. Commit as you go: stage by path, one commit per file group.

1. **`summary.ts` and `summary.test.ts` first** (pure, no engine): real-work predicate from counters; digest builder (truncation, edited-file list, size cap); reply parser (`GOAL:` line plus six headings; rejects a reply missing a heading); task state file formatter (frontmatter then body). Table-driven tests including an empty transcript, a huge transcript (cap holds), and a reply with the headings out of order.
2. **`clear.tsx`**: counters on `prompt.submit` and `tool.call`; the `command.run` hook per the flow above; `.catch` guard.
3. **`clear.test.ts`** with `claude-code/testing` (see `register.test.ts` and `blast.test.ts` for the helpers): trivial session passes straight to `next`; real work saves then clears and toasts; model not answered asks and `Clear anyway` clears; `Cancel` does not call `next`; empty transcript with counters refuses; a recent save skips the duplicate; non-composer origin refuses on failure instead of asking; task worktree writes the state file.
4. **Wire into `register.tsx`.**

## Acceptance criteria

- `claude plugin validate session-band-plugin` passes; `claude plugin test session-band-plugin` passes with the new tests (the count was 74 before this phase).
- A clear after real work always ends in exactly one of: saved then cleared, cleared after the user chose `Clear anyway`, or refused. Never cleared with nothing saved and no question.
- The hook never calls the model for a trivial session.
- No change to `blast.tsx`, the band, or any retired script.

## Verification

| Check | Command | Expect |
|---|---|---|
| Manifest and module | `claude plugin validate session-band-plugin` | passes |
| Tests | `claude plugin test session-band-plugin` | all green, count above 74 |
| Live: real work | edit a file, `/clear` | toast with a saved path; `agent-session active` shows the summary; the new session starts |
| Live: trivial | open a session, `/clear` straight away | no file written, clear is immediate |
| Live: ordering | after the real-work clear, read the saved summary | it describes the cleared session, which proves the transcript was readable inside the hook |
| Live: failure | run with `agent-session` off PATH | question "Save failed ... Clear anyway?" |

The live rows need a human in an interactive terminal; report them as pending, do not claim them.

## Traps

- **rtk swallows exit codes**: read the text of validate and test output, not the status. The `agent-session` run inside the plugin is not affected, check `exitCode` on the result.
- **Validator refuses `$` across imports.** If it complains, move the call into `clear.tsx`.
- **Live review gate.** In `~/dotfiles` the `agent-review` gate refuses your next input while a review is pending; clear it before starting, and expect a new pending review when you finish.
- **Do not edit** `scripts/agent-review`, the Pi `agent-review` extension, or the nvim module: Pi must not edit the gate that reviews Pi.
- **Model names.** `'sonnet'` is an alias the engine resolves like `--model`; do not hard-code a dated id.
- **The hook must stay quick on the trivial path.** No process spawns before the real-work check.

## Out of scope

Phase 4 review, blast radius changes, any retirement of `save-session` (the skill stays), vim mode, `@agent`.
