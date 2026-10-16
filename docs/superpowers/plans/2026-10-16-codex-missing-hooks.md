# Codex Missing Hook Targets Implementation Plan

> **For agentic workers:** Execute task-by-task after the user approves this plan. Preserve the user's existing edits to `codex/.codex/hooks.json`.

**Goal:** Stop Codex from invoking hook commands whose configured executable files do not exist.

**Architecture:** Keep the existing hook configuration as the source of truth and remove only handlers with confirmed missing targets. Retain every handler whose target exists. Do not copy Claude hooks into Codex: hooks use event-specific input and output contracts, and some Claude hooks mutate files or were deliberately retired.

**Tech Stack:** Codex `hooks.json`, shell command target checks, Python JSON parser, GNU Stow package.

**Spec:** No `SPEC.md` supplied.

## Global Constraints

- Preserve all pre-existing user edits in `codex/.codex/hooks.json`.
- Do not edit tests or any `verify:` line.
- Do not implement new hook behavior or alter Claude/Pi configuration.
- Do not deploy hook changes into `~/.codex` until the user approves the reviewed implementation.
- Leave plugin-manifest warnings for separate investigation; current evidence does not identify their source.

## Review Focus

- Missing handler targets: remove only entries for paths confirmed absent; keep valid targets.
- Existing but non-executable handler: inspect mode and invocation; do not remove it as a missing-file case.
- Commented command strings / paths with spaces: parse and inspect as shell commands, not by naïve whitespace splitting.
- Matcher validity: Codex uses its own tool names; do not assume Claude names like `MultiEdit` map to Codex events.
- Lost behavior: removing stale registrations disables their intended features; report each removed command so the user can choose a later port if needed.

---

### Task 1: Remove stale Codex hook registrations

**Files:**
- Modify: `codex/.codex/hooks.json` (preserve current user edits)

**Interfaces:**
- Input: existing handlers and target-existence inventory.
- Output: every remaining command handler points to an existing executable or an available command; handlers without a source are removed and listed in the change summary.

- [ ] **Step 1: Reconcile the dirty config before editing.** In an isolated worktree, compare its committed `hooks.json` with the current user-edited version. Carry forward all unrelated user changes, including SessionStart ordering and formatting, then make only the approved stale-target changes.
- [ ] **Step 2: Recheck each target.** The previously confirmed missing absolute paths are `lint-on-write.sh`, `judge-reminder.sh`, `context-threshold-check.sh`, `enforce-agent-whitelist.sh`, `protect-lint-configs.sh`, `enforce-bash-safety.sh`, and Stop's `lint-autofix.sh`, all under `~/.codex/hooks/`. Recheck existence and executable mode at implementation time; remove a matching handler only if it is still missing and no tracked Codex implementation has been added.
- [ ] **Step 3: Remove only handlers for confirmed missing targets.** Keep existing targets, such as `observe-session.sh`, `capture-bash-error.sh`, `herdr-agent-state.sh`, and the NotchBar command. Do not create placeholders or duplicate Claude scripts.
- [ ] **Step 4: Check the resulting configuration.** Run `python3 -m json.tool codex/.codex/hooks.json`; inspect every remaining `command` and verify that executable paths exist. Review the diff to confirm no unrelated changes were lost.
- [ ] **Step 5: Report the behavior removed.** List each removed registration and its event/matcher, state that its feature no longer runs in Codex, and identify any that need a separate Codex-native port.

## Deliberately separate follow-up

Codex logs also show three plugin-manifest warnings: `ignoring hooks: expected a string, string array, object, or object array; found object`. The warning rows share one process and timestamp, but current evidence does not attribute them to a manifest. Investigate plugin loading and manifest schemas separately; do not edit cached plugin manifests as part of this stale-command cleanup.

## Implementation handoff

This plan recommends removing confirmed stale registrations, which restores successful hook dispatch but disables those registered behaviors. If preserving those behaviors is required, revise the plan to identify which hooks to port and their desired Codex behavior before implementation. After approval, implement in an isolated worktree and return the exact diff for review before deployment.
