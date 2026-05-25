# Startup: Linting Status Check (coding projects only)

After CGC check:

```bash
grep "^linting:" .claude/profile.md 2>/dev/null
```

| Result | Action |
|---|---|
| `linting: enabled` | Remind: lint configs (`biome.json`, `eslint.config.*`, `.noslop`, etc.) are **protected** — do not edit them. Biome auto-fix runs at end of each turn. Pre-commit gate is active. |
| `linting: disabled` | Silent skip. |
| No output | Ask: "Enable linting for this project? (yes/no)" — if yes, run `/claude-init` linting step or install noslop manually. |

**Override:** user says "add linting" or "set up linting" → run setup regardless of existing flag.
