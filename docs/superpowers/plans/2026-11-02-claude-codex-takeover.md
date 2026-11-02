# Claude/Codex Takeover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Explicitly continue Claude work in Codex when Claude usage is exhausted.
**Architecture:** Extend the existing session inbox; launch into the existing worktree; retain Pi dispatch and all existing review machinery.
**Tech Stack:** Existing Python CLI, zsh/macOS shell, Git/jj, Codex CLI, shared skills. No new runtime dependencies.
**Spec:** `docs/superpowers/specs/2026-11-02-claude-codex-takeover-design.md` (draft; human review precedes runtime implementation).

## Global Constraints

- Preserve existing plugins, scripts, hooks and defaults.
- Add context switching and narrowly refactor existing session metadata where required.
- No provider auto-fallback, new scheduler, branch merge, process kill or worktree relocation.
- Pi/pueue remains the implementation lane; review approval remains human-only.
- Do not overwrite locally modified Codex hooks or deploy global settings during this work.
- Commit every coherent unit through commit-funnel with literal session worktree and named paths; ask before push.

## Review Focus

- Main checkout metadata incorrectly assigned to a feature worktree (Task 1).
- Concurrent saves or takeovers overwrite state or launch two writers (Tasks 1/2).
- Claude has exhausted quota before summary can be generated (Task 2).
- Hidden state lives in both common repo and worktree, with denied access possible (Tasks 2/3).
- Existing unmerged rules/review work is accidentally overwritten (Task 3).

### Task 1: Correct worktree identity in existing session inbox

**Worker:** Luna/Haiku equivalent; planner settles compatibility questions.
**Files:** Modify `scripts/agent-session`; create `scripts/tests/test_agent_session_handoff.py`.
**Interfaces:** `resolve_context(path) -> {repo_root, worktree, branch, head}`;
existing `save` retains flags/output, with additive optional metadata and unique IDs.
Shared storage uses repo_root; branch/work_type/status/log use worktree.

- [ ] Write fixture tests: two linked worktrees, main on different branch, old records, detached checkout, concurrent saves, save-versus-idle/reindex, corrupt index and spaces in paths; assert correct identity, no lost entries and corrupt-file preservation.
- [ ] Run `python3 -m unittest discover -s scripts/tests -p 'test_agent_session_handoff.py'`; confirm failures demonstrate missing behavior.
- [ ] Implement context separation, collision-safe notes and locked atomic index update across every existing writer, failing closed on corrupt/inaccessible indexes, without changing legacy record semantics or pointer behavior.
- [ ] Run the same tests; run `python3 -m unittest discover -s scripts/tests -p 'test_*session*.py'`; all pass.
- [ ] Commit only implementation and tests through commit-funnel.

### Task 2: Add explicit context handoff and takeover

**Worker:** Sol-class planner defines validation/claim boundaries; cheaper worker implements bounded substeps.
**Files:** Modify `scripts/agent-session`, `scripts/tests/test_agent_session_handoff.py`.
**Interfaces:** `handoff --from cc|codex --to cc|codex --reason usage-exhausted|return --stdin <worktree>`;
`takeover <checkpoint> --harness codex --dry-run|--owner-released [--prepare-only] <worktree>`;
`release <claim-token> --owner-released <worktree>` clears only a matching claim.
--prepare-only returns claim token/context prompt for manual Desktop launch; CLI holds its token until child return.
Return to Claude is checkpoint save with --reason return and parent linkage, Codex stop/release, then human reopen/load in original Claude session; no automatic Claude launch.
Checkpoint adds source_session/parent_checkpoint/reason as optional metadata.
Takeover returns nonzero for invalid identity, inaccessible context, live writer,
claim conflict or failed launch; dry-run exits zero only when validation passes.

- [ ] Add failing tests for missing summary recovery, stale HEAD warning, deleted checkout refusal, old ambiguous note refusal, identity mismatch, active pueue writer, claim conflict, manual acquire/release, wrong-token refusal, denied inbox access and exact Codex argv.
- [ ] Add byte-preservation tests for staged/unstaged/untracked/ignored files, dry-run zero mutation and failed launch cleanup. Fixtures/stub binaries only; never real provider calls or pueue mutations.
- [ ] Run Task 1's focused command; confirm new cases fail.
- [ ] Implement subcommands and bounded factual checkpoint fallback. Reuse inbox/frontmatter parsing. Launch with subprocess argv; no shell interpolation, --worktree, global permission changes, auto-idling or automatic stale-claim cleanup.
- [ ] Run focused tests; exercise fake-codex handoff/manual-return round trip and inspect emitted prompt/context paths and parent linkage.
- [ ] Planner reviews concurrency/ownership limits and error messages, then commits named paths through funnel.

### Task 3: Expose shared takeover instructions and model policy

**Worker:** Cheap mechanical editor; Sol-class planner reviews rule conflicts.
**Files:** Create `shared/skills/context-switch/SKILL.md`; minimally modify
`shared/AGENTS.md`, `shared/research-tool-routing.md`, `codex/.codex/agents/scout.toml`,
`codex/.codex/agents/worker.toml`, `docs/codex-claude-mod-port.md`.
Inspect `scripts/bootstrap-dirs.sh` and `scripts/sync-agent-rules.sh`; change only if
existing shared-skill discovery does not expose the new skill.
**Interfaces:** Explicit invocation `context-switch` -> show candidate checkpoints
for chosen worktree -> dry-run -> owner release -> takeover. No SessionStart auto-launch.

- [ ] Read current feat/jj-wt/feat/ctx-cap and B/C/D diff surfaces again; record any changed heads before edits. Do not merge/cherry-pick existing work blindly.
- [ ] Write narrow compatibility tests in `scripts/tests/test_agent_session_handoff.py` for skill paths, scoped hidden discovery, legacy preservation and explicit planner-role exception.
- [ ] Run focused tests and confirm new assertions fail.
- [ ] Add skill instructions covering checkpoint selection, canonical rules, worktree-local review state, explicit access, exhausted-summary recovery and Codex-to-Claude return.
- [ ] Add narrow planner continuity exception to existing Pi-only text. Preserve Pi dispatch and human review. Validate installed model IDs before pinning low-tier scout/worker; leave unrelated routing unchanged.
- [ ] Run focused tests, TOML parsing, and existing shared-skill discovery checks without installing or syncing live config.
- [ ] Show config diffs; commit named paths through funnel.

### Task 4: Prove integration and run opt-in live pilot

**Worker:** Cheap agents run mechanical checks; Sol-class planner reviews evidence.
**Files:** Add integration cases to Task 1 test file; extend `docs/codex-claude-mod-port.md` with observed parity/limitations and pilot results only after execution.
**Interfaces:** Existing `pi-view`, `pi-checks`, `pi-outcome`, `:AgentReview` remain unchanged.

- [ ] Add integration test for checkpoint -> fake Codex -> checkpoint return, including pending review and existing Pi task identifiers; assert no approval or branch mutation.
- [ ] Run focused test file, `scripts/tests/test_pi_queue.py`, `scripts/tests/test_pi_wait.py`, `scripts/tests/test_commit_funnel.py` and `node --test scripts/pi-checks.test.mjs` with fixture isolation.
- [ ] If implementation branch has an approved matching SPEC.md, run ac-run check and floor-guard as required; never edit checks to pass or approve the spec.
- [ ] Human pilot in disposable feature worktree: existing Claude save or factual recovery, Codex CLI takeover, hidden folder/context inspection, one approved Pi dispatch, normal review and return checkpoint. Desktop pilot uses --prepare-only claim, explicit same-folder selection, claim-aware skill and token-matched release after stopping writer.
- [ ] Record exact passed/failed steps; do not claim Codex hook/UI parity from fixture tests. Keep feature manual if pilot is incomplete.
- [ ] Commit evidence/docs through funnel. No push, merge, installation or branch cleanup without human authorization.

## Consolidation and stop condition

Implementation starts from a fresh short feature branch after design review.
No dependency on merging ctx-cap, jj-wt, review B/C/D or Linux work. Those branches
are references and conflict surfaces, not bundles to absorb. Each implementation
worker gets this plan plus the design and its own bounded file list; separate
writing tasks use separate worktrees. Stop when opt-in same-worktree continuity
passes, with preserved code, existing Pi dispatch and unchanged review approvals.

## Implementation record (2026-11-02)

User approved both plans. Implemented on feat/cc-codex without merging other
worktrees or altering live modified hooks. Task 1 identity/index locking, Task 2
explicit handoff/claim/launch/return, and Task 3 shared skill/model/bootstrap
configuration are complete. Task 4 fixtures and existing queue/funnel/verifier
regressions pass; live read-only Codex Luna confirmed checkpoint goal/branch and
released its claim. Manual Desktop/Claude return and live human review approval
remain unverified. No claim of native hook/UI parity or global activation.
