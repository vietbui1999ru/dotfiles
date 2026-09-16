# Global Claude Configuration

## Instruction Priority (Strict Order)

1. **User explicit instruction in this session** — "skip the skill", "use Opus", "just answer"
2. **Project CLAUDE.md** — project-specific overrides (e.g. wiki-startup.md always-invoke)
3. **These global rules** (imported below, in order: core → tool-routing → startup → skill-invocation)
4. **Superpowers plugin skills** — extend rules, do not override them; overrides live in `skill-invocation.md`
5. **Claude Code native defaults** — assumed when no rule covers the behavior

When sources conflict: higher number loses. Explicit always beats implicit.

---

@~/.claude/rules/core.md
@~/.claude/rules/tool-routing.md
@~/.claude/rules/startup.md
@~/.claude/rules/skill-invocation.md

# Niche domain rules (not auto-loaded): intermediate.md, learning.md, research.md,
# applied-ai.md, model-routing.md — see claude-setup/rules/ and ~/.claude/rules/

# @-import them in project CLAUDE.md for learning-domain or formal-methods work

## Knowledge

# Wiki at ~/repos/llm-wiki — JIT only. Invoke wiki-context skill or: qmd query "<topic>"

# Do NOT load index at startup. Full index at ~/repos/llm-wiki/index.md if needed

## Quality rules (judge-extracted)


# graphify

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

@RTK.md
