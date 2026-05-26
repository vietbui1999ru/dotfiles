# Startup: Session State Injection (all projects)

After slop check:

```bash
grep "^status:" .claude/session-state.md 2>/dev/null
```

| Result | Action |
|---|---|
| `status: active` | Read `.claude/session-state.md` fully. Tell user: "Resuming session: [goal]. In progress: [list]. Next steps: [list]." Wait for user to confirm direction. |
| `status: idle` | Silent skip. |
| No output (file missing) | Silent skip. |

**Override:** user says "ignore session state" or "start fresh" → skip regardless of status.

## Agent state files (multi-agent harness)

After session check:

```bash
MAIN_REPO=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd 2>/dev/null)
grep -l "^status: active" "${MAIN_REPO}/.agents/claimed/"*.state.md 2>/dev/null
```

| Result | Action |
|---|---|
| One or more `.state.md` with `status: active` | For each: read `agent_task:` and `## In Progress`. Tell user: "Agent TASK-XXX has saved state — in progress: [summary]." |
| No matches | Silent skip. |
