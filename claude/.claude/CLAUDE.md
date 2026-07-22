# Global Claude Configuration

## Instruction Priority (Strict Order)

1. **User explicit instruction in this session** — "skip the skill", "use Opus", "just answer"
2. **Project CLAUDE.md** — project-specific overrides (e.g. wiki-startup.md always-invoke)
3. **These global rules** (imported below, in order: core → communication → editing → domains → model-routing → skill-invocation → caveman-mode)
4. **Superpowers plugin skills** — extend rules, do not override them; see `superpowers-integration.md`
5. **Claude Code native defaults** — assumed when no rule covers the behavior

When sources conflict: higher number loses. Explicit always beats implicit.

---

@~/.claude/rules/core.md
@~/.claude/rules/communication.md
@~/.claude/rules/editing.md
@~/.claude/rules/tool-routing.md
@~/.claude/rules/intermediate.md
@~/.claude/rules/model-routing.md
@~/.claude/rules/skill-invocation.md
@~/.claude/rules/caveman-mode.md
@~/.claude/rules/startup-cgc.md
@~/.claude/rules/startup-project-checks.md
@~/.claude/rules/startup-session.md

# Niche domain rules (not auto-loaded): see claude-setup/rules/ in project repos

# @-import them in project CLAUDE.md for learning-domain or formal-methods work

## Knowledge

# Wiki at ~/repos/llm-wiki — JIT only. Invoke wiki-context skill or: qmd query "<topic>"

# Do NOT load index at startup. Full index at ~/repos/llm-wiki/index.md if needed

## Quality rules (judge-extracted)

# @~/.claude/rules/quality.md — uncomment when judge populates it

# graphify

- **graphify** (`~/.claude/skills/graphify/SKILL.md`) - any input to knowledge graph. Trigger: `/graphify`
When the user types `/graphify`, invoke the Skill tool with `skill: "graphify"` before doing anything else.

@RTK.md
