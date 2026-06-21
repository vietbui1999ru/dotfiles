# Startup: Project Checks (coding projects only)

Run after CGC check, in order.

## Linting

```bash
grep "^linting:" .claude/profile.md 2>/dev/null
```

| Result | Action |
|---|---|
| `linting: enabled` | Remind: lint configs (`biome.json`, `eslint.config.*`, `.noslop`) are **protected**. Biome auto-fix runs each turn. Pre-commit gate active. |
| `linting: disabled` | Silent skip. |
| No output | Ask: "Enable linting? (yes/no)" — if yes, run `/claude-init` linting step or install noslop manually. |

**Override:** "add linting" or "set up linting" → run setup regardless.

## Slop Register

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
