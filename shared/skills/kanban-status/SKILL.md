---
name: kanban-status
description: Render .agents/ task board — shows inbox/claimed/done columns with agent assignments. Invoke any time you need a status snapshot of running agents and tasks.
allowed-tools: "Bash,Read"
---

# Kanban Status

Render the current agent task board from `.agents/` directories.

## Step 1 — Find repo root

```bash
REPO=$(git rev-parse --show-toplevel 2>/dev/null) || { echo "Not in a git repo"; exit 1; }
AGENTS_DIR="${REPO}/.agents"
```

If `.agents/` doesn't exist: report "No .agents/ directory found — nothing to show."

## Step 2 — Read registry

```bash
REGISTRY="${AGENTS_DIR}/registry.json"
```

If registry exists, load it to get agent→task assignments. If missing, proceed without it (show task IDs only).

## Step 3 — List tasks per column

```bash
INBOX=$(ls "${AGENTS_DIR}/inbox/"*.md 2>/dev/null | xargs -I{} basename {} .md | sort)
CLAIMED=$(ls "${AGENTS_DIR}/claimed/"*.md 2>/dev/null | xargs -I{} basename {} .md | sort)
DONE=$(ls "${AGENTS_DIR}/done/"*.md 2>/dev/null | xargs -I{} basename {} .md | sort)
```

## Step 4 — Render board

Output a formatted 3-column board:

```
╔══════════════╦══════════════════════╦══════════════╗
║    INBOX     ║       CLAIMED        ║     DONE     ║
╠══════════════╬══════════════════════╬══════════════╣
║ TASK-003     ║ TASK-001 @session-ab ║ TASK-002 ✓   ║
║ TASK-004     ║ TASK-005 @session-cd ║              ║
╚══════════════╩══════════════════════╩══════════════╝

Total: 2 inbox · 2 claimed · 1 done
```

For claimed tasks: look up the agent ID from registry.json `agents[].task` match → show `@<id[:8]>` (first 8 chars of ID). If registry missing, show task ID only.

## Step 5 — Event log tail (optional)

If `.agents/events.jsonl` exists, show last 5 events:

```
Recent events:
  [2026-05-19T10:45Z] task_complete  TASK-002 (session-cd)
  [2026-05-19T10:00Z] task_claimed   TASK-001 (session-ab)
```

## Output format rules

- Always show all 3 columns even if empty (show `—` for empty)
- Claimed column shows agent ID from registry if available
- Done column shows ✓ suffix
- Failed tasks (in done/ with `.failed` suffix): show ✗ suffix
- Keep task IDs truncated to 12 chars max for alignment
