# Startup Checks (all projects)

Run in order at session start. Skip silently when their conditions don't apply.

## 1. CodeGraphContext check (coding projects only)

Skip entirely for: markdown-only repos, dotfiles repos, `~/repos/llm-wiki`.

**Step 1 — instant flag check (always first, no bash, no analysis):**

```bash
grep "^codegraphcontext:" .claude/profile.md 2>/dev/null
```

**State machine:**

| Result | Action | Ask? |
|---|---|---|
| `codegraphcontext: enabled` | Verify index live via `list_indexed_repositories`; re-index silently if missing | Never ask |
| `codegraphcontext: session` | Ask "Re-index with CGC?" (yes/no) — re-index only, never "add CGC?" | Never ask "add CGC?" |
| `codegraphcontext: disabled` | Stop. Do nothing. | Never ask |
| No output (key missing) | Proceed to Step 2 | Ask Q1 + Q2 |

**Step 2 — first-time flow (only when key is missing):**

> Q1: "Analyze this repo for CodeGraphContext eligibility?" (yes/no)

If yes → run:
```bash
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" \
  -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.kt" -o -name "*.rb" \
  -o -name "*.php" -o -name "*.swift" -o -name "*.cs" -o -name "*.cpp" -o -name "*.c" -o -name "*.h" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" \
  -not -path "*/dist/*" -not -path "*/__pycache__/*" | wc -l
find . -type f \( -name "*.py" -o -name "*.ts" -o -name "*.tsx" -o -name "*.js" \
  -o -name "*.go" -o -name "*.rs" -o -name "*.java" -o -name "*.cpp" -o -name "*.c" \) \
  -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/vendor/*" \
  | sed 's/.*\.//' | sort -u
find . -maxdepth 4 \( -name "Dockerfile" -o -name "docker-compose*.yml" -o -name "*.tf" \
  -o -name "*.yaml" -path "*/.github/workflows/*" \) -not -path "*/.git/*" 2>/dev/null
```
Report: file count, languages, infra. Threshold met = 2+ languages OR >100 files OR infra present.

> Q2: "Add CodeGraphContext?" (session / daemon / no)

- `session`: `codegraphcontext index .` → write `codegraphcontext: session`
- `daemon`: `codegraphcontext watch .` → write `codegraphcontext: enabled`
- `no`: write `codegraphcontext: disabled`

If Q1 = no → write `codegraphcontext: disabled`. Do not ask Q2.

**Override:** user says "check CGC" or "add CGC" → run Step 2 regardless of existing flag.

## 2. Project checks (coding projects only, after CGC check)

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

## 3. Session state injection (all projects, after slop check)

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
