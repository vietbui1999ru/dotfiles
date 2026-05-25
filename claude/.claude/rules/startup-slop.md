# Startup: Slop Register Injection (all projects)

After linting check:

```bash
# Project-level register (highest priority)
cat .claude/slop-register.md 2>/dev/null | grep -v "^#\|^$\|^\*empty" | wc -l

# Global register fallback
grep -v "^#\|^$\|^\*(empty" ~/.claude/slop-register.md 2>/dev/null | wc -l
```

| Result | Action |
|---|---|
| Project register has entries | Load `.claude/slop-register.md` — treat every entry as a hard constraint on code generation |
| Only global register has entries | Load `~/.claude/slop-register.md` — same treatment |
| Both empty or missing | Silent skip |

**Override:** user says "show slop register" → print contents regardless of emptiness.
