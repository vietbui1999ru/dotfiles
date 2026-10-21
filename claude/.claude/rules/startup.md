# Startup Checks (all projects)

Run in order at session start. Skip silently when their conditions don't apply.

## 0. Resume from saved context (first, always)

Trigger: a cleared/new session, or the user says "continue", "pick up", "previous session", "where were we".

Before any other check, look for saved context from the previous session:
1. Job tmp: `$CLAUDE_JOB_DIR/tmp` (`/Users/vietquocbui/.claude/jobs/<job>/tmp`). Read plan files and prompt files named in the last saved state.
2. Session notes: `.agents/sessions/` in the repo. Read the newest `status: active` note, and its `Next Session Should` list.

Then tell the user what was found (goal, done, next step) and confirm the direction before acting. Skip only when the user says "start fresh" or "ignore session state".

## 1. Project checks (coding projects only)

### Linting

```bash
grep "^linting:" .claude/profile.md 2>/dev/null
```

| Result | Action |
|---|---|
| `linting: enabled` | Remind: lint configs (`biome.json`, `eslint.config.*`, `.noslop`) are **protected**. Biome auto-fix runs each turn. Pre-commit gate active. |
| `linting: disabled` | Silent skip. |
| No output | Ask: "Enable linting? (yes/no)" — if yes, run `/claude-init` linting step or install noslop manually. |

**Override:** "add linting" or "set up linting" → run setup regardless.

### Slop Register

```bash
cat .claude/slop-register.md 2>/dev/null | grep -v "^#\|^$\|^\*empty" | wc -l
grep -v "^#\|^$\|^\*(empty" ~/.claude/slop-register.md 2>/dev/null | wc -l
```

| Result | Action |
|---|---|
| Project register has entries | Load `.claude/slop-register.md` — hard constraints on code generation |
| Only global register has entries | Load `~/.claude/slop-register.md` — same treatment |
| Both empty or missing | Silent skip |

**Override:** "show slop register" → print contents regardless.

## 2. Session state injection (all projects, after slop check)

```bash
grep "^status:" .claude/session-state.md 2>/dev/null
```

| Result | Action |
|---|---|
| `status: active` | Read `.claude/session-state.md` fully. Tell user: "Resuming session: [goal]. In progress: [list]. Next steps: [list]." Wait for user to confirm direction. |
| `status: idle` | Silent skip. |
| No output (file missing) | Silent skip. |

**Override:** user says "ignore session state" or "start fresh" → skip regardless of status.

### Agent state files (multi-agent harness)

```bash
MAIN_REPO=$(cd "$(dirname "$(git rev-parse --git-common-dir)")" && pwd 2>/dev/null)
grep -l "^status: active" "${MAIN_REPO}/.agents/claimed/"*.state.md 2>/dev/null
```

| Result | Action |
|---|---|
| One or more `.state.md` with `status: active` | For each: read `agent_task:` and `## In Progress`. Tell user: "Agent TASK-XXX has saved state — in progress: [summary]." |
| No matches | Silent skip. |
