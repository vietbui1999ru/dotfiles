# ralph-structured Design Spec

**Date**: 2026-05-22  
**Status**: Approved  
**Implementation target**: `~/dotfiles/claude/.claude/skills/ralph-structured/`

---

## Problem

`/ralph-loop` re-injects the same prompt each iteration with no enforcement on:
- Task scope per iteration (agent can attempt multiple things at once)
- Completion condition (text promise is fragile; agent can lie or misfire)
- Stuckness (agent can loop forever on an impossible task)
- Continuity (agent has no structured record of what prior iterations did)

The transcript architecture (PRD → JSON task list → one task per fresh context) solves all four, but requires a wrapper skill — the plugin itself cannot be modified (managed Anthropic artifact).

---

## Architecture

Single skill `ralph-structured` with two phases separated by a user review gate.

```
/ralph-structured "goal"
        │
        ▼
  [Phase 1: Decompose]
  LLM generates .claude/tasks.json
  Display task list → user approval gate
        │
        ▼
  [Phase 2: Launch]
  Craft task-driver prompt (see below)
  /ralph-loop --completion-promise 'ALL_TASKS_DONE'
        │
        ▼
  [Each iteration — driven by re-injected prompt]
  Read ralph-log.md → read tasks.json → pick first pending task
  Increment attempts → work on task only → run test gate
  Mark done/blocked → append to ralph-log.md
        │
        ▼
  [Exit]
  Surface blocked tasks to user
```

The plugin is untouched. All iteration logic lives in the crafted prompt.

---

## Task File Format

Path: `.claude/tasks.json`

```json
[
  {
    "id": "TASK-001",
    "title": "Short imperative title",
    "acceptance_criteria": "Specific, testable condition",
    "test_cmd": "npm test -- --testPathPattern=auth",
    "status": "pending",
    "attempts": 0
  }
]
```

**Status values**: `pending` → `done` | `blocked`

**Decomposition rules**:
- One task = one unit completable in a single context window
- Clear pass/fail signal: `test_cmd` OR unambiguous `acceptance_criteria`
- Ordered by dependency (blockers first)
- Max ~15 tasks; flag and ask user to narrow if scope is larger

**Stuckness threshold**: `attempts >= 3` with status still `pending` → mark `blocked`, move on.

**Resume behavior**: if `.claude/tasks.json` already exists with pending tasks when the skill is invoked, offer to resume (skip Phase 1) rather than overwriting. Show remaining tasks and ask user to confirm.

---

## Kanban Sync (optional `--kanban` flag)

When `--kanban` is passed, mirror task state into `.agents/`:

| Task status | `.agents/` location |
|---|---|
| `pending` (not yet started) | `inbox/TASK-XXX.md` |
| `pending` (attempts > 0, active) | `claimed/TASK-XXX.md` |
| `done` | `done/TASK-XXX.md` |
| `blocked` | `done/TASK-XXX.failed.md` |

This lets `/kanban-status` show loop progress without coupling the default path to the multi-agent harness.

---

## Loop Protocol (Injected Prompt)

This is the full prompt that ralph-loop re-injects each iteration:

```
STRUCTURED LOOP PROTOCOL

Task file: .claude/tasks.json
Log file:  .claude/ralph-log.md

Each iteration, follow these steps exactly:

1. Read .claude/ralph-log.md (if it exists) — understand what prior iterations did
2. Read .claude/tasks.json — find the first task with status "pending"
3. If no pending tasks: confirm all are "done" or "blocked", then output:
   <promise>ALL_TASKS_DONE</promise>
4. Increment that task's "attempts" counter in tasks.json BEFORE starting work
5. Work ONLY on that task — do not touch other tasks
6. When work feels complete: run test_cmd if present
   - Tests pass → set status "done"
   - Tests fail AND attempts < 3 → leave status "pending" (retry next iteration)
   - attempts >= 3 → set status "blocked" regardless of test result
7. Append one line to .claude/ralph-log.md:
   [ITER {N}] {task-id}: {one sentence — what happened, outcome}

ORIGINAL GOAL: {user's goal inserted here}
```

---

## Auto-Suggestion Rule (CLAUDE.md)

Add to rules: when a user request shows any of these signals, suggest `/ralph-structured` before proceeding:

- 3+ distinct deliverables mentioned
- "implement", "build", "create" at feature scope (not single-file edits)
- Task explicitly mentions testing or verification as a requirement
- Sequential dependencies described ("first X, then Y, then Z")
- Estimated to span multiple context windows

Suggestion format: name the command, explain the one-task-per-iteration + stuckness protection benefit, let user decide. Do not auto-launch.

---

## Files Created/Modified

| File | Action |
|---|---|
| `~/.claude/skills/ralph-structured/SKILL.md` | New skill |
| `~/.claude/rules/applied-ai.md` | Add auto-suggestion rule |
| `.claude/tasks.json` | Runtime — created by skill per project |
| `.claude/ralph-log.md` | Runtime — created by loop per project |

`tasks.json` and `ralph-log.md` should be added to `.gitignore` by the skill if not already present (they're ephemeral loop state, not project artifacts).

---

## Out of Scope

- Modifying the ralph-loop plugin
- Parallel task execution (one task per iteration is the core invariant)
- Automatic task dependency resolution (user orders tasks manually at review gate)
