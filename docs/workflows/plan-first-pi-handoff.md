# Work Order — Plan-first Claude, automated Pi handoff, conformance fix

**For:** Pi (implementer). **Repo:** `~/dotfiles`. **Written:** 2026-09-21.
**Status:** ready to build, not started.

Build the three parts in order; Part 3 depends on nothing but is the first task meant to travel
through Part 2's handoff, so leave it last.

**Before you start:** `agent-review` is live in this repo. Every run of yours that changes a file
produces a pending review and blocks your next input until it is resolved. Either review each run
with `:AgentReview` in Neovim, or run `python3 scripts/agent-review mode off` for the duration and
`mode on` when done. The CLI is not on `PATH`; call it by path. Check state with
`python3 scripts/agent-review status`.

---

## Context

Claude starts every session in `auto` mode and implements directly. The goal is the inverse: Claude
plans, Pi implements. The `delegate-pi` skill already has the machinery; nothing instructs Claude to
reach for it, so Claude keeps the work by default.

Facts verified against Claude Code's documentation before writing this — do not re-litigate them:

- `"plan"` is a valid `permissions.defaultMode`, alongside `default`, `acceptEdits`, `auto`,
  `dontAsk`, `bypassPermissions`.
- A user-level `defaultMode` applies to terminal sessions and to `claude -p`. A project's
  `.claude/settings.json` overrides it.
- **No hook can set permission mode.** Hooks only read `permission_mode`. The only two mechanisms
  are `defaultMode` in a settings file and the `--permission-mode plan` flag. This is why Part 1 is
  a settings change, not a SessionStart hook.

`~/.claude/settings.json` and `~/.claude/CLAUDE.md` are stow symlinks into `dotfiles`, so edits in
the repo take effect immediately. No restow needed.

---

## Part 1 — Start every session in plan mode

**File:** `claude/.claude/settings.json`

Set `permissions.defaultMode` from `"auto"` to `"plan"`. That is the whole change.

**Acceptance:** a new Claude session in any directory opens in plan mode; a project containing
`{"permissions":{"defaultMode":"auto"}}` in its `.claude/settings.json` still opens in auto.

---

## Part 2 — Make Pi the default implementer

### 2a. New rule file

**Create:** `claude/.claude/rules/plan-handoff.md` — a real file, not a symlink. (`core.md`,
`applied-ai.md`, `intermediate.md`, `learning.md` and `research.md` are symlinks into
`~/repos/llm-wiki`; `model-routing.md`, `startup.md` and `skill-invocation.md` are local files and
are the precedent to follow.)

The rule must say, in the same terse style as `skill-invocation.md`:

1. **Default after plan approval is dispatch, not implementation.** Claude packages the approved
   plan and hands it to Pi. Implementing directly is the exception and needs a stated reason.
2. **Use the existing skill.** `shared/skills/delegate-pi/SKILL.md` — *delegate mode* (async via
   `pueue`, which is installed) for one task, *parallel delegate mode* for independent tasks. Do not
   build new dispatch machinery.
3. **Dispatch form**, from the skill's context-injection section:
   `pi --model <explicit-model> -p "$(cat <plan>.md)" < /dev/null`. The `< /dev/null` is required;
   the skill documents why.
4. **Model tier is always explicit**, per `claude/.claude/rules/model-routing.md`. No silent
   defaults on any dispatch.
5. **Claude keeps two categories and does not hand them over:**
   - **Debugging and root-cause work** — anything where the next step depends on reading the
     previous result. Async delegation loses the hypothesis chain.
   - **The review gate itself** — `agent-review`, `post-run-verifier`, `pi-lens`. Pi editing the
     gate that reviews Pi is a loop to refuse on principle.

   Everything else is Pi's by default, including multi-file features, migrations and refactors.
6. **After dispatch:** report the pueue task id. On collection, review Pi's diff before it is
   committed. In `~/dotfiles` the live review gate already forces this — point at `:AgentReview`
   rather than restating the flow.

### 2b. Wire it in

**Edit:** `claude/.claude/CLAUDE.md`

- Add `@~/.claude/rules/plan-handoff.md` to the import block, after `skill-invocation.md`.
- Update the priority-order line in the header (currently "core → tool-routing → startup →
  skill-invocation") so the file keeps describing itself accurately.

**Acceptance:** a new session lists `plan-handoff.md` among its loaded rules; asked to implement a
multi-file feature after plan approval, Claude dispatches to Pi; asked to debug a failure, Claude
keeps the work.

---

## Part 3 — phase-2-conformance: diagnose, then fix

**Failing test:** `pi/.pi/agent/extensions-available/provider-governance/test/phase-2-conformance.test.ts`
→ `Pi test-only provider > routes an RPC prompt only to the loopback mock`.

### Established, do not redo

- The failure is at **line 501** — `server.getRequests().some(r => r.path === "/v1/messages")`. The
  mock server received **no** request. The exit-code assertion above it passes. (An earlier reading
  of this as an exit-code failure was wrong.)
- It fails identically with the working-tree changes stashed, so the `agentops-cli` removal
  (`376727f`) did not cause it. Pre-existing.
- **Leading hypothesis — version drift.** `package.json` pins `@earendil-works/pi-coding-agent` at
  **0.80.10**; the `pi` on `PATH` is **0.85.1**. The harness spawns `pi` from `PATH`
  (`spawn("pi", args, …)`, ~line 87), not the pinned dependency, so the suite has been validating
  against whatever Pi is installed rather than the version it declares.
- **Unverified:** the failure was observed under `bun test`. The project's runner is `tsx --test`
  (`npm run conformance`).

### Steps

1. **Reproduce under the project's own runner:** `npm run conformance` from the package directory.
   If it passes there, the real finding is "this suite is not runnable under `bun test`" — stop,
   report that, and propose either a `bun`-compatible script or a note in the package README.
2. **Make the failure diagnosable before diagnosing it.** The assertions at lines 501–511 report
   `false == true` and discard `result.stderr`, `result.stdout` and `result.events`, which is the
   only reason the cause is still a hypothesis. Put them in the assertion messages. Prerequisite,
   not polish.
3. **Find why no request reaches the mock**, checking in this order: does the extension still
   register the provider under 0.85.1; is the RPC input shape `{"type":"prompt","message":…}` still
   accepted; does `agent_settled` arrive at all.
4. **Pick the fix once the cause is known**, and state which and why:
   - *Pin the harness to the local dependency* — spawn `node_modules/.bin/pi`. Hermetic, immune to
     drift, but stops verifying against the Pi actually in use.
   - *Raise the pin to 0.85.1* — verifies reality, absorbs whatever API drift surfaces, larger blast
     radius.
5. `test/phase-2-conformance.test.ts` **is editable.** The no-edit rule covers only agent-review's
   planner-written `agent-review.integration.test.ts`. This is not that file.

**Acceptance:** `npm run conformance` passes; `npm test` reports 123 passing with no new failures;
the chosen fix and its rationale are in the commit message.

---

## Verification

Run all of it from `~/dotfiles`.

| What | Command | Expected |
|---|---|---|
| Part 1 | new session, any dir | opens in plan mode |
| Part 1 escape hatch | scratch project with `defaultMode: "auto"` | opens in auto |
| Part 2 | new session | `plan-handoff.md` among loaded rules |
| Part 2 end-to-end | approve a plan | Claude dispatches to Pi, reports the pueue id |
| Part 2 negative | ask Claude to debug something | Claude keeps the work |
| Part 3 | `npm run conformance` in the provider-governance package | passes |
| Part 3 suite | `npm test` there | 123 pass |
| Regression | `cd pi/.pi/agent/extensions/agent-review && bun test` | 32 pass |
| Regression | `nvim --clean --headless -l scripts/agent-review-nvim-test.lua` | 43 checks, 0 failed |

Note: this shell's rtk wrapper discards exit codes at the top level. To check a status, wrap it —
`sh -c '<cmd> >/dev/null 2>&1; echo $?'` — or a failing command will look like it passed.

---

## Risks and open items

- **`bin/council` is missing.** `delegate-pi`'s council mode points at a `bin/council` engine that
  does not exist in this repo (only `repos/llm-wiki/.council/`). Delegate mode, which this work
  order uses, does not need it — but council mode is probably broken and deserves its own look.
- **Plan mode costs one approval per session.** Approving a plan exits plan mode and asks auto vs.
  manual for the remainder. If the friction outweighs the benefit, the revert is one word in
  `settings.json`.
- **Nine unpushed commits** sit on `main` from the preceding session. Consider pushing before Pi
  starts writing in the same repo.
