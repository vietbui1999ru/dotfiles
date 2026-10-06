# session-band phase 1: band and threshold guard

Date: 2026-10-06. Audience: Pi, building cold. Spec: `docs/superpowers/specs/2026-10-06-session-band-mod-design.md` (read the Band section and Phases table first).

## Goal

Ship `register.tsx` so the session-band mod draws the status band in `AbovePrompt` and enforces the 70% context guard. Then retire the bash status line and the bash threshold hook in the same PR. Do not touch phases 2 to 4 (blast radius, /clear, review).

## Already established, do not re-derive

- The pure modules exist and are tested: `band.tsx` (`drawBand`), `git.ts` (`readGit`), `format.ts`, `palette.ts`, `repo.ts` (`resolveRepo`), `threshold.ts` (`guardAgent`, `softStop`), `messages.ts`, `format.test.ts`, `threshold.test.ts`, `types/index.d.ts`, `.claude-plugin/plugin.json`, `hooks/hooks.json` (names `./register.tsx`, which does not exist yet).
- They live today **outside the repo**, in `~/.claude/dev-mods/345a71c2-0f72-42df-a3b7-124282186541/session-band/`. Copy that folder as the starting point. Do not edit it in place.
- The `/clear` intercept spike passed (spike log shows `clear hook ran`). Irrelevant to phase 1, noted so you do not re-test it.
- The old status line gets `@agent` from a field the mod API does not have. It is dropped. Vim mode is dropped too.
- API facts, checked in this build's types (`~/.claude/dev-mods/*/session-band/.claude-plugin/types/claude-code/index.d.ts` appears once the mod loads; before that, the skill's `types/claude-code.d.ts`):
  - Usage: `on('session.measure', ...)` input has `context.percent?` and `rateLimits: {kind, percentUsed}[]` (`kind` is `five_hour` or `seven_day`). `$.session.usage()` returns the same on demand. Percentages can have one decimal, so round with `whole()`.
  - Tool guard: `on('tool.call', ...)`. `e.tool` narrows (`'Agent'`, `'Bash'`, `'Write'`...), `e.file_path`, `e.command` are on `e`. Return `{ deny: string }` to refuse. `await next(e)` returns the tool result `{ result, context?, text, ... }`. Adding `context: [text]` to that result is the equivalent of the old PostToolUse exit-2 message the model reads.
  - Model: `await $.session.model()`. Cwd: `await $.session.cwd()`. File mtime: `await $.fs.stat(path)` gives `mtimeMs`.
  - Output style: **hypothesis, verify.** `prompt.compose` input carries `outputStyle: { name } | null`. Plan: hook `prompt.compose`, read `e.outputStyle?.name`, store it, `return next(e)`. If that does not fire before the first draw, fall back to `await $.settings.read()` and read its `outputStyle` key. Skip the segment when the name is `default` or null.
  - Draw: `on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => ...)`. Yield with `next(e)` when `e.props.hasSurvey`. Read values with `read($, atom)`, write with `update($, atom, fn)`; a write redraws.
- Guard behavior to preserve exactly (from `hooks/context-threshold.sh`): Agent spawns denied at `>= 70`; after any other tool at `>= 70`, one long directive per crossing, shorter re-fire while still over; below 70 clears the flag; save-critical paths and commands never trigger; a save in the last 5 minutes suppresses. All of that logic is already in `softStop`. You only wire it.

## Decisions made (do not reopen)

1. **Repo home:** `session-band-plugin/` at the repo root, matching `llm-wiki-plugin/`. Not under `claude/.claude/` (stow would link it into `~/.claude/`).
2. **Loading:** add `CLAUDE_CODE_PLUGIN_DIRS` to the `env` block of `claude/.claude/settings.json`, value `~/dotfiles/session-band-plugin`. This is the documented way to load a folder in every session, and it watches the folder for reloads.
3. **Notified flag and usage live in `$.state`** (the `'session-band'` contract already declares `usage`, `git`, `outputStyle`, `isNotified`). No files under `~/.claude/state/`.
4. **Fresh percent in the guard.** `tool.call` calls `$.session.usage()` itself rather than reading the atom, so the guard does not wait for a `session.measure`. The atom feeds the band only.

## Work

All paths are relative to the repo root.

### 1. Copy the plugin in

`cp -R` the dev-mods `session-band/` folder to `session-band-plugin/`. Delete any `.claude-plugin/types/` directory the engine generated (it is regenerated on load; add it to `.gitignore` if the repo lacks a rule). Keep `types/index.d.ts` (the state contract, hand-written).

### 2. Write `session-band-plugin/hooks/register.tsx`

`export const register: Register = on => { ... }`, type from `'claude-code'`. Hooks:

| Event | Does |
|---|---|
| `session.start` | Refresh git into `$.state`; seed usage from `$.session.usage()` |
| `session.measure` | Write `usage` (ctx, five, seven via `whole()`), from `e.context.percent` and `e.rateLimits` |
| `turn.complete` | Refresh git (branch, dirty, ahead/behind move during a turn) |
| `tool.call` | If `e.tool === 'Bash'`, refresh git after `next`. Run the guard (below) |
| `prompt.compose` | Capture output style name into `$.state`; always `return next(e)` unchanged |
| `ui.render` `AbovePrompt` | `drawBand` with dir from `shortDir(cwd, home)`, model from `shortModel`, usage, git, style |

Guard in `tool.call`:

1. `const { context } = await $.session.usage()`; `const denial = guardAgent(context.percent, e.tool)`; if set, `return { deny: denial }` without calling `next`.
2. Otherwise `const r = await next(e)`. If `r` has `deny`, return it untouched.
3. Build a `SoftStopCheck`: `tool: e.tool`, `filePath` from `e.file_path` when present, `command` from `e.command` when Bash, `nowMs: await $.clock.now()`, `isNotified` from state, `taskId` and `statePath` from `resolveRepo($)`, `lastSavedMs` from `(await $.fs.stat(statePath)).mtimeMs` (catch: missing file means undefined).
4. `softStop(check)`: `clear` sets `isNotified` false; `notify` sets it true and returns `{ ...r, context: [...(r.context ?? []), text] }`; `pass` returns `r`.
5. Wrap the guard so a throw never blocks a tool: use `.catch(($, e, next) => next.called ? next(e) : { deny: 'session-band guard failed' })` only for the Agent branch; the soft-stop branch should fail open (return `r`).

Do not copy any file-writing from the shell hook (`touch` flags, `.state.md` writes). The mod only reads the state file's mtime.

Dir and git refresh need `$.session.cwd()`. Home comes from `$.process.run(['printenv', 'HOME'])` if `$` has no env accessor; check the types first and prefer the accessor.

### 3. Tests

Add `session-band-plugin/hooks/register.test.ts` using `claude-code/testing` (read the test section of the skill's `reference.md` first: a test holds the engine's `$` and an `on` whose hooks it can fire). Cover: Agent denied at 70 and passed at 69; first crossing appends a `context` entry and the second is the short form; a save-critical write passes; the band draws `ctx:NN%` with the right colour at 39/40/70. Existing tests stay green.

### 4. Cutover (same PR, last commit)

- `claude/.claude/settings.json`: delete the `statusLine` block; delete the two `context-threshold.sh` entries (the `.*` matchers under `PostToolUse` and `PreToolUse`); add `CLAUDE_CODE_PLUGIN_DIRS` under `env`.
- Delete `claude/.claude/statusline-command.sh` and `claude/.claude/hooks/context-threshold.sh`.
- `docs/workflows/ai-workflow-consolidation.md` mentions them: update the line, do not rewrite the doc.
- Remove the dev-mods copy at `~/.claude/dev-mods/345a71c2-.../session-band/` only **after** the repo copy loads, or the session loads two bands.
- Leave `enforce-bash-safety.sh` alone (phase 2).

## Acceptance criteria

- Band shows `dir branch[*] [local] [ahd:N] [bhd:N] [stsh:N] [wt:name] ctx:N% 5h:N% 7d:N% [style] (model)` in the gruvbox colours, matching the old line apart from the dropped vim mode and `@agent`.
- `ctx` is green below 40, yellow 40 to 69, red from 70. `5h` and `7d` are green below 70, yellow 70 to 89, red from 90.
- Agent spawn is denied at 70% or more. One soft-stop directive per crossing. No directive on save-critical writes or within 5 minutes of a state-file save.
- After the cutover commit there is no `statusLine` key, no `context-threshold` reference, and neither script exists.
- No `~/.claude/state/ctx-notified*` or `statusline-context.json` is read or written by anything in the repo.

## Verification

| Check | Command | Expect |
|---|---|---|
| Manifest and module | `claude plugin validate session-band-plugin` | no errors |
| Types | `tsc -p session-band-plugin` (after one load) | clean |
| Tests | `claude plugin test session-band-plugin` | all green, including the old two files |
| No stragglers | `rg -n "context-threshold\|statusline-command\|statusline-context" --glob '!docs/superpowers/**'` | no output |
| Live band | start `claude` in a git worktree with the new settings | band visible, ctx/5h/7d present, worktree shown as `[wt:name]` |
| Live guard | at 70%+ context, ask for an Agent spawn | denied with the CONTEXT THRESHOLD message |

The live rows need a human at a terminal; Pi cannot do them. Report them as pending, do not claim them.

## Traps

- **rtk swallows exit codes.** Top-level Bash returns 0 whatever happens. Read the output text of validate and test, do not trust the status. Run git as `/usr/bin/git` in a worktree-isolated session.
- **Live review gate.** In `~/dotfiles` the `agent-review` gate can block input mid-run. Work in a worktree and expect `:AgentReview` after.
- **Two bands.** The dev-mods copy and `CLAUDE_CODE_PLUGIN_DIRS` both loading draws the band twice. Remove the dev-mods copy as step 4 says.
- **Percent is whole-number rounded** in the old script (`printf "%.0f"`). `whole()` does the same. Compare thresholds on the rounded value as the old hook did.
- **`$.session.usage().context.percent` is absent** on a fresh or just-compacted session. `guardAgent` and `softStop` already treat undefined as pass. Do not default it to 0.
- The mod is not in a stowed package. Do not run `restow.sh` for it.

## Out of scope

Blast radius, `/clear` flow, review segment, pane, `agent-review` changes, vim mode, `@agent`.
