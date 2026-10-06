# session-band: one plugin for status band, diff review, blast radius and /clear

Date: 2026-10-06. Status: approved design, not yet implemented.

## Purpose

`session-band` is a single Claude Code plugin made of several hook modules. It replaces the bash status line and three shell hooks, and it adds a post-turn diff review and a Bash blast-radius check. It lives in this dotfiles repo and loads as a mod, hot-reloaded in a session.

## Decisions

1. One plugin, several modules: `band`, `blast`, `clear`, `review`. All are listed in `hooks/hooks.json`. They share the git, repo and palette helpers.
2. The band renders in `AbovePrompt`, not `$.ui.status`, so the gruvbox palette survives.
3. Each old script is retired by a hard cutover in the same PR that ships its replacement. There is no fallback period.
4. Diff review is post-turn only. Pre-apply gating is not built. The native permission dialog stays as it is.
5. Review state lives in a neutral `.agent-review/` directory shared by Pi and Claude.
6. One CLI, `scripts/agent-review`, owns the snapshot and decision mechanics. The Pi extension and the mod are adapters over it. The nvim Lua module keeps its own copy, pinned by a contract test.
7. Follow-ups are routed to the producing agent only. The other agent is informed, never auto-prompted.
8. The blast-radius check has three tiers and fails closed when nobody can answer.
9. `/clear` auto-saves a session summary first, and falls back to a gate if the hook cannot intercept.

## Band

- **Segments, in order:** dir, git, review, ctx, 5h, 7d, style, model. Git shows branch, dirty marker, ahead/behind, stash and the real worktree name.
- **Ported from `statusline-command.sh`:** dir shortening, git facts, ctx/5h/7d colour thresholds (ctx 40/70, limits 70/90), output style (skipped when `default`), and the model name with its `claude-` prefix stripped.
- **Dropped:** vim mode (no mod API; the native prompt shows it), `@agent` (kept only if the phase 0 spike finds a cheap way to derive it), and the `statusline-context.json` cache.
- **Review segment:** `rev <id> +N −M` in the warning tone while a pending review exists. It is derived from the pending records and disappears once decided.
- **Existing code:** `band.tsx`, `git.ts`, `format.ts`, `palette.ts`, `repo.ts` and `threshold.ts` are reused. `hooks.json` already names `./register.tsx`, which does not exist yet. Phase 1 writes it.
- **Retires:** `claude/.claude/statusline-command.sh`, `claude/.claude/hooks/context-threshold.sh`, the `statusLine` block in `settings.json`, and the context-threshold hook entry.

## Blast radius

A `tool.call` hook on Bash classifies each command into one of three tiers.

1. **Pass:** read-only or clearly scoped commands run untouched.
2. **Ask with preview:**
   - These pause for the user: `rm`, `mv` over existing files, `git reset --hard`, `git clean`, `find -delete`, `chmod -R`, overwriting redirects, and `docker`/`kubectl` deletes.
   - The preview shows expanded glob targets, file and size counts, git-tracked status, and a dry-run result where the tool has one (`git clean -n`, `git diff --stat`, `rsync -n`).
   - Commands that cannot be parsed (`eval`, `$(...)`, `curl | sh`) land here, labelled "can't analyze".
3. **Hard deny:** the existing catastrophic patterns are unconditional: `rm -rf` on root or home, force-push to main or master, `git reset --hard origin/…`.

The check never executes the command to preview it. Where `$.ui.ask` has nobody to answer (`claude -p`, unattended sessions), the command is denied.

**Retires:** `claude/.claude/hooks/enforce-bash-safety.sh` and its `settings.json` entry. **Extra cutover gate:** a deliberately dangerous command must be denied before the old hook is removed.

## /clear

A `command.run` hook on `clear` does this:

1. If the session had real work (file edits or more than a few turns), it generates the summary body with `$.model.complete` over the session transcript and runs `agent-session save --harness cc --goal "…" --stdin`. It then toasts the saved path.
2. It calls `next(e)` so the clear proceeds. Trivial sessions skip the save.
3. If the save fails, it asks "Save failed, clear anyway?". It never loses the context silently.
4. Task worktrees (`.agent-task-id` present) write `.agents/claimed/<TASK>.state.md` instead, using the existing `repo.ts` logic.

**Fallback:** if the phase 0 spike shows the hook cannot intercept the built-in `clear`, `/clear` is refused with "run save-session first" whenever nothing was saved in the last five minutes.

## Diff review (post-turn)

- **Producers:** Pi (existing extension) and Claude (new module). Each pending and decision record gets an `agent: "pi" | "claude"` field.
- **Neutral state dir:** `.agent-review/`. The nvim module's path constant and snapshot exclusion move to it, as do the Pi extension and its tests.
- **CLI `scripts/agent-review`** gains `snapshot`, `begin`, `end` and `validate-decision`. They cover the tree snapshot with its exclusion, ref handling, record shapes and identifier validation. Trees are compared, never commits. A contract test pins the CLI and the nvim Lua module to the same tree for the same working tree.
- **Claude module:** snapshots at `prompt.submit`, snapshots at turn end, and writes the pending record through the CLI. It reads the decision and sends one follow-up with `$.session.send` or `append`.
- **Routing:** the follow-up goes to the producing agent only. In the plan-then-hand-off flow, Pi gets the follow-up and Claude gets a toast and the band segment, for example `pi run 3f2a: 1 rejected, 2 notes`. Claude is never auto-prompted.
- **Pane (`/review`):** file list with `+N −M`, a diff view per hunk, and these buttons:
  - **Accept** marks the hunk reviewed.
  - **Deny** reverse-applies the hunk with `git apply -R`.
  - **Revise** stores a `{file, line, note}` note.
  - **Edit** opens `nvim +<line> <file>` in a new kitty or tmux window.
  - **Done** snapshots and writes the decision.
- **Rules ported from the nvim module:** reject-by-delete for files the run created, and refusal to reject a file changed after the run ended, with an override.
- **Nvim stays the power tool:** `:AgentReview` opens the same record.
- **Assumption to verify:** Pi's handoff runs in a separate worktree so a Pi run and a Claude run do not mix diffs.
- **Spec change:** this reverses decision 5 in `docs/workflows/agent-review.md` ("Scope: Pi only"). That doc is updated when phase 4 ships.

## Phases and gates

| Phase | Scope | Retires |
|---|---|---|
| 0. Spikes | Verify four things: a `command.run` hook on built-in `clear` runs first, `tool.call` sees Edit/Write input, `$.ui.ask` works from a Pane, and `agent` is derivable. | none |
| 1. Band | Write `register.tsx`, wire `AbovePrompt`, port the threshold guard. | `statusline-command.sh`, `context-threshold.sh`, `statusLine` block |
| 2. Blast radius | Three-tier Bash checker with preview. | `enforce-bash-safety.sh` |
| 3. /clear flow | Auto-save with the gate fallback. | none |
| 4. Review | CLI refactor, Pi extension change, nvim path edit, Claude module, Pane, band segment. | none |

**Gate per cutover:** `claude plugin validate` and `claude plugin test` green, plus a short manual checklist run live. The old script or hook is removed in the same PR as its replacement.

**Handoff:** phases 1 to 3 go to Pi as plans. Phase 4 stays in Claude, because Pi must not edit `agent-review`, the gate that reviews Pi.

## Phase 0 results

Spike mod: `~/.claude/dev-mods/a6a54c5a-11f1-46fe-9339-b1f450339838/spike/`. It logs to `~/.claude/jobs/345a71c2/tmp/spike.log` because `/clear` wipes the transcript.

- **`$.ui.ask` from a Pane button: works.** Pressing the button returned `Allow`. The Pane-based review and the blast-radius preview can use it.
- **`tool.call` input: works.** Write exposes `file_path`, `content`. Edit exposes `file_path`, `old_string`, `new_string`, `replace_all`. Both also carry `tool` and `tool_use_id`.
- **`@agent` in the band: dropped.** The API search found no field for the session's agent name.
- **Hook on built-in `clear`: works.** The spike log has `clear hook ran args="" origin=composer` after a live `/clear`, so `command.run{command=clear}` fires. `/clear` follows decision 9 as designed and the gate fallback is not needed. Whether the hook fires before the transcript is wiped is still to be confirmed in phase 3, since the log line alone does not show ordering.

## Risks and unknowns

- Hooking the built-in `clear` command is unverified. This build's types say `command.run` hooks run for slash commands, but that was not confirmed for `clear`.
- `$.ui.ask` from inside a Pane is unverified.
- A hook may rewrite Bash calls before the blast-radius check sees them (a PreToolUse hook rewrote a Bash call during this design session). The checker must tolerate rewritten commands.
- Review depends on a trustworthy start snapshot even when the working tree is already dirty. The CLI inherits the existing rule of excluding paths by removing them from the scratch index, never with an exclude pathspec.

## Non-goals

- Pre-apply edit approval.
- Embedded editing of hunk text in the Pane.
- A persistent band segment for blast radius or `/clear`.
- Rewriting the nvim module's diffview or gitsigns integration.
