# Startup: CodeGraphContext Check (coding projects only)

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
