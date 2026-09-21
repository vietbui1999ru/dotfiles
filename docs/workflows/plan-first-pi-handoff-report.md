# Plan-first Claude / Pi handoff — implementation report

## Purpose

Record the completed implementation of `plan-first-pi-handoff.md` and the remaining manual checks for Claude review.

## Implemented changes

### Part 1 — Claude starts in plan mode

`claude/.claude/settings.json`

- Changed `permissions.defaultMode` from `"auto"` to `"plan"`.
- This is the user-level setting. Project-level `.claude/settings.json` files remain able to override it, including with `"auto"`.

### Part 2 — Pi is default implementer after plan approval

Created the real (non-symlink) rule file:

- `claude/.claude/rules/plan-handoff.md`

The rule requires Claude to:

- Dispatch approved plans to Pi by default; direct implementation requires a stated exception.
- Reuse `shared/skills/delegate-pi/SKILL.md`, using pueue-backed delegate mode for one task and parallel delegate mode for independent tasks.
- Dispatch with an explicit model and `stdin` redirected from `/dev/null`:

  ```bash
  pi --model <explicit-model> -p "$(cat <plan>.md)" < /dev/null
  ```

- Apply explicit model-tier selection from `model-routing.md`.
- Keep debugging/root-cause work and review-gate work (`agent-review`, `post-run-verifier`, `pi-lens`) in Claude.
- Report the pueue task ID, then review Pi's diff with `:AgentReview` before commit.

`claude/.claude/CLAUDE.md`

- Imports `@~/.claude/rules/plan-handoff.md` immediately after `skill-invocation.md`.
- Updates the priority-order description to include `plan-handoff`.

## Part 3 — conformance diagnosis

No source change was necessary.

`npm run conformance` passes when run through the package's declared runner, `tsx --test`. This confirms the failure reported from `bun test` is runner-specific rather than a provider-registration, RPC-input, or `agent_settled` regression.

Recommended follow-up: add a short package README note that Phase 2 conformance must run through `npm run conformance` (or add and maintain a Bun-compatible runner script). Do not change the spawn target or raise the Pi dependency pin without a failing project-runner reproduction.

## Verification completed

From `~/dotfiles`:

- `cd pi/.pi/agent/extensions-available/provider-governance && npm run conformance`
  - 24 passing, 0 failing.
- `cd pi/.pi/agent/extensions-available/provider-governance && npm test`
  - 123 passing, 0 failing.
- `cd pi/.pi/agent/extensions/agent-review && bun test`
  - 32 passing, 0 failing.
- `nvim --clean --headless -l scripts/agent-review-nvim-test.lua`
  - 43 checks, 0 failed.
- `git diff --check`
  - Passed.
- Parsed `claude/.claude/settings.json` successfully and verified `plan-handoff.md` is a regular file, not a symlink.

The provider-governance package initially had no installed dependencies, so `npm run conformance` could not find `tsx`. `npm ci` was run only to execute verification; its generated `node_modules` directory was removed afterward. No lockfile changes were made.

## Manual Claude review checklist

1. Start a new Claude session outside any project with `.claude/settings.json`; confirm it opens in plan mode.
2. Start a new Claude session in a scratch project that sets `permissions.defaultMode` to `auto`; confirm the project override wins.
3. Confirm the new session reports `plan-handoff.md` as a loaded rule.
4. Approve a multi-file implementation plan; confirm Claude submits an explicit-model Pi command through pueue and reports its task ID.
5. Ask Claude to diagnose a failing test; confirm it keeps the hypothesis-driven debugging work rather than delegating it.
6. Collect a Pi task and confirm Claude opens/reviews the resulting diff with `:AgentReview` before any commit.

## Review state

No commit was created. Tracked implementation changes are limited to:

- `claude/.claude/settings.json`
- `claude/.claude/CLAUDE.md`
- `claude/.claude/rules/plan-handoff.md`

This report is an additional uncommitted documentation file.
