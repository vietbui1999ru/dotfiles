# AI Workflow Consolidation — Work Order

Status: ready to execute, 2026-09-16. Written to be executed by an agent with no prior
context on the decisions behind it. Read "Before you start" in full before touching
anything.

## Goal

Reduce an overgrown multi-harness agent setup to a minimal one. Claude Code keeps
planning, research, and long-horizon work. Pi keeps the build/test daily loop. Codex
stays a model provider inside Pi and never becomes a harness. Anything mirrored across
harnesses is a deletion candidate.

Target surface:

| Surface | Now | Target |
|---|---|---|
| Rule files | 16 | 4 |
| Personal skills | 34 (+18 plugin) | ~11 total |
| Custom agents | 19 | 0–2 |
| Hooks | 9 (5 fire every tool call) | ~5 (1 fires every call) |

## Evidence this is safe

Measured across 19 real Claude Code session transcripts (2026-07-10 → 2026-09-16):
7 of ~52 skills were ever invoked; **0 of 19 custom agents were ever spawned**. Bash was
called 754 times and EnterWorktree/ExitWorktree 44 times — real parallelism runs through
git worktrees, not the Agent tool.

Skills with actual usage: `wiki-context` 3, `firecrawl` 3, `grill-me` 3, `save-session` 2,
`brainstorming` 1, `artifact-design` 1, `artifact-diagramming` 1.

Known limits of that measurement: ~10-week retention window, Pi/Codex usage invisible,
caveman undercounted because it fires via hook rather than the Skill tool.

## Before you start — four traps

1. **Two independent llm-wiki clones exist.** `~/repos/llm-wiki` is a standalone clone
   with its own `.git`. `~/dotfiles/repos/llm-wiki` is a git submodule with a separate
   git dir. They are at the same commit today but are NOT the same checkout, and the
   README's claim that the former is a symlink to the latter is false. **Every rule,
   agent, and skill symlink under `~/.claude/` resolves to the standalone clone.** So
   edits to rules/agents/skills are commits in `~/repos/llm-wiki`, and the dotfiles
   submodule pin does not move until you separately commit there and bump the submodule.
2. **Concurrent work is in flight.** `~/repos/llm-wiki` has uncommitted changes including
   `AGENT-UPDATE-2026-09-16-graphify-removed.md` dated today, and `~/dotfiles` has a large
   uncommitted pi-extension/theming stream. Another session is mutating this system. Check
   `git status` in both repos before each phase and do not assume a clean tree.
3. **Three distinct homes for artifacts.** Rules and agents and most skills live in
   `~/repos/llm-wiki/claude-setup/`. A few skills live in `~/dotfiles/claude/.claude/skills/`.
   Six skills exist ONLY as real directories in `~/.claude/skills/` with no tracked source
   — deleting those is unrecoverable, so commit them into dotfiles first if keeping.
4. **Deletion is the mechanism, git is the safety net.** Every removal below must land as
   its own commit so a single phase can be reverted without disturbing the others. Never
   batch multiple phases into one commit.

## Phase 0 — safety net

Land or explicitly drop the uncommitted Pi work: `post-run-verifier.ts`,
`lib/post-run-verifier-core.ts`, `lib/review-gate-suspension.ts`, `lib/review-auto-policy.ts`,
`lib/nvim-rpc.ts`, `lib/openai-usage.ts` and their tests. Commit the in-flight
AgentOps/Obsidian teardown (staged deletions of `pi-obsidian.ts`, `pi-session.ts`, and the
matching docs). Tag the result in both repos as the revert point for everything below.

Do not proceed until both `~/dotfiles` and `~/repos/llm-wiki` have clean trees or
deliberately-parked branches.

## Phase 1 — delete provably dead

Nothing references any of these. Zero behavioral risk.

- `~/dotfiles/claude/.claude/rules/quality.md` — empty stub; its `@`-import in CLAUDE.md
  is already commented out. Remove both.
- `~/.claude/skills/resume-gen.md`, `~/.claude/skills/style-blog.md` — loose `.md` files,
  not valid skill format (skills require `<dir>/SKILL.md`), unreachable.
- `~/repos/llm-wiki/claude-setup/skills/instinct-triage/`,
  `~/repos/llm-wiki/claude-setup/skills/sync-tier0/` — never symlinked into `~/.claude/skills/`.
- `~/.pi/agent/extensions/lib/interactive-session-checkpoint.ts` — broken symlink, target
  does not exist in dotfiles, no code references the name.
- `observe-session.sh` — appends a line to `~/.claude/logs/*.jsonl` on every tool call; no
  reader found anywhere in the repo. Remove the script and its PostToolUse entry.
- `judge-reminder.sh` — nags to run `/judge`, which has zero invocations in all 19
  transcripts. Remove the script and its PostToolUse entry.

Verify: start a session, confirm no hook errors and no missing-import warnings.

## Phase 2 — collapse duplicate clusters

One survivor per cluster; delete the others and update every reference.

| Cluster | Keep | Delete |
|---|---|---|
| Debugging | `superpowers:systematic-debugging` | custom `diagnose` |
| TDD | `superpowers:test-driven-development` | custom `tdd` |
| Parallel dispatch | git worktrees (already the real mechanism) | `spawn-parallel-agents`, `dispatching-parallel-agents`, `subagent-driven-development` |
| Planning | `superpowers:writing-plans` | `to-prd`, `to-issues`, `ralph-structured` |
| Review | built-in `/code-review` | `review-council`, `requesting-code-review`, `receiving-code-review` |
| Mistake capture | `capture-mistake` (fold in `synthesize-mistakes`) | `capture-slop` |
| Session save | `save-session` | `clear-context` (it only wraps save-session) |
| Grilling | `grill-me` | `grill-with-docs` |

Then rewrite `~/dotfiles/claude/.claude/rules/skill-invocation.md` so its trigger table
names only survivors. An entry pointing at a deleted skill is worse than no entry.

## Phase 3 — rules 16 → 4

Merge into exactly four files.

- **`core.md`** ← merge of `core.md` + `communication.md` + `editing.md` + `caveman-mode.md`.
  This dedupes the ~50-LOC rule currently stated twice (`editing.md` "LOC Gate" and
  `communication.md` "Code generation limit"). Note the cross-repo split: the first three
  live in `~/repos/llm-wiki/claude-setup/rules/`, `caveman-mode.md` lives in
  `~/dotfiles/claude/.claude/rules/`. Put the merged file in llm-wiki (the established
  source of truth for rules) and delete the dotfiles copy.
- **`tool-routing.md`** — unchanged. Actively used; `firecrawl` is one of only seven
  skills with real usage.
- **`startup.md`** ← merge of `startup-cgc.md` + `startup-project-checks.md` +
  `startup-session.md` (~4.3KB read every session today, all three dotfiles-local).
- **`skill-invocation.md`** — as rewritten in Phase 2. Fold `superpowers-integration.md`
  into it and delete that file.

Demote `intermediate.md`, `learning.md`, `research.md`, `applied-ai.md` to Tier 2 pull,
loaded by `wiki-context` on domain detection. **`CLAUDE.md` already claims these are "not
auto-loaded" — that comment is false today; all four are `@`-imported into every session.**
Fixing this is the single largest per-session context reduction in this work order.

Verify: measure per-session context before and after.

## Phase 4 — agents 19 → 0 (or 2)

Delete the custom roster in `~/repos/llm-wiki/claude-setup/agents/`. Built-in `Explore`,
`Plan`, and `general-purpose` cover all observed usage, and the custom `explore` (haiku)
collides with built-in `Explore` by casing alone.

Optional reserve of two if wanted: `code-reviewer`, `security-auditor`. Everything else
goes and returns only through the trial tier in Phase 7 if a real gap appears.

Move `career-outreach` out of the dev-loop roster entirely — it is a personal job-search
agent unrelated to this system, not a deletion candidate but not part of this roster either.

Then delete `enforce-agent-whitelist.sh` and its PreToolUse entry — it whitelists a roster
that no longer exists.

Also merge `context-threshold-check.sh` and `context-threshold-notify.sh` into one hook.
Today both fire on every single tool call and independently re-derive the same cached
percentage.

## Phase 5 — Pi side (measure first)

**Do not delete anything here until Pi-side usage has been measured the way Claude Code's
was.** All evidence in this document is Claude Code only. Deleting the wrong review gate
is the most expensive available mistake.

Once measured:

- Pick ONE review gate: `~/dotfiles/pi/.pi/agent/extensions/pi-review-gate.ts` or
  DiffViewer's `pi-extension/`. Delete the other. They do the same job.
- Define the boundary between `post-run-verifier.ts` and `.pi-lens/config.json`, or
  collapse to one. Two verification layers currently coexist.
- Finish the AgentOps teardown: `~/repos/AgentOps` **does not exist on disk** yet is the
  default `obsidianVault` in `~/dotfiles/shared/agent-workflow.default.json` and is
  referenced in Commandr's README. Remove the dangling references.
- Bring `herdr-agent-state.*` and `pi-keymaps.ts` under dotfiles management or delete
  them — both currently live unmanaged in `~/.pi/`.

## Phase 6 — fix sync topology

- Reconcile the confirmed drift between `~/.claude/skills/gh-stack/SKILL.md` and
  `~/dotfiles/shared/skills/gh-stack/SKILL.md`, then convert the copy to a symlink so it
  cannot drift again. Fixes made in Claude Code currently never reach Pi/Codex.
- Commit the six source-less skills (`approval-workflow`, `clear-context`, `delegate-pi`,
  `kanban-status`, `review-council`, `graphify`) into dotfiles, or delete them — whichever
  Phase 2 decided. Today they exist only in `~/.claude/skills/` and would be lost on a wipe.
- Audit remaining copy-based flows: `shared/AGENTS.md` → opencode/codex, plus the two
  "materialize once, never re-sync" files (`known_marketplaces.json`,
  `agent-workflow.default.json`). Symlink them or document the fork deliberately.
- Reconcile the two llm-wiki clones (trap 1). Either make `~/repos/llm-wiki` a symlink to
  the submodule as the README claims, or update the README to describe reality.

## Phase 7 — mechanical expiry (the anti-regrowth mechanism)

Without this the system regrows. It must be enforced by the harness, not by a rule — a
rule that says "audit your trial tier" has the same self-enforcement problem that produced
this sprawl.

**Manifest** — `~/.claude/trial/manifest.json`, one entry per trial artifact:

```json
{"name": "some-skill", "kind": "skill", "path": "~/.claude/skills/some-skill",
 "added": "2026-09-16", "expires": "2026-10-16", "source": "community/xyz"}
```

**Usage counter** — `scripts/trial-usage.sh <name>`: greps `~/.claude/projects/*.jsonl`
for invocations of that name and prints a count. This is the reusable measurement tool;
it is what made this consolidation decidable, and it should decide every future promotion.

**Expiry hook** — `SessionStart`, not PreToolUse. Fires once per session, so it adds zero
per-tool-call tax. It reads the manifest, finds entries past `expires`, runs the usage
counter on each, and reports:

```
3 trial artifacts expired: foo (0 uses), bar (5 uses), baz (0 uses).
Promote or delete. Core budget: 11/11 skills, 2/2 agents.
```

It **reports, never auto-deletes** — deletion stays a human decision, consistent with the
existing "ask before destructive operations" rule.

**Budget enforcement** — the same hook counts core skills/agents/rules and warns when over
budget. Promotion out of `trial/` requires deleting something already in core. The budget
is a hard count, not a guideline; that constraint is the only structural barrier to a
second sprawl.

Budget: ~11 skills / 0–2 agents / 4 rules / ~5 hooks.

## Verification

- Per-session context measured before and after Phase 3.
- One real feature run end-to-end through plan → build → verify → PR gate, confirming no
  deleted artifact was needed.
- Each phase is its own commit in its own repo, so any single phase reverts cleanly.
