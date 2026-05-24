# Skill Invocation Contract — Mechanical Triggers

Replaces the probabilistic "1% chance" heuristic from superpowers with deterministic patterns.
Priority: this file overrides `using-superpowers` trigger semantics. User instructions always override this.

## Decision Tree

```
User submits a message
  ↓
1. User explicitly names a skill or asks "should I use X?"
   → YES: Invoke that skill immediately. No judgment.
  ↓ NO
2. User says "skip the skill", "just answer", "don't brainstorm"
   → YES: Skip all skills. Honor explicitly.
  ↓ NO
3. Check domain trigger table below
   → Match found: invoke listed skill(s) in order before responding
   → No match: proceed with direct response
```

## Domain Trigger Table

| Task Type | Skills (in order) | Trigger Pattern |
|---|---|---|
| Architecture, system design, multi-agent design | `wiki-context` | "design", "redesign", "architecture", "system", multi-component task |
| Brainstorming, exploring alternatives | `wiki-context` → `brainstorming` | "what could we do", "how should we approach", "explore options" |
| Debugging — test failure or unexpected behavior | `wiki-context` → `systematic-debugging` | error messages, failing tests, "why is this broken" |
| Security review | `wiki-context` → `security-review` | security, auth, injection, permissions, credentials |
| Multi-step implementation (3+ deliverables) | `wiki-context` | feature build, migration, refactor spanning files |
| Post-generation: substantial code/plan/design | `/judge` (after generating, not before) | response contains 20+ lines of code, numbered plan, or architecture decisions |

## Skill Invocation Order (when multiple apply)

1. `wiki-context` — always first; loads relevant patterns
2. Domain skills (`brainstorming`, `systematic-debugging`, etc.) — second
3. Implementation skills (`feature-dev`, `frontend-design`, etc.) — last

`wiki-context` satisfies the superpowers requirement for "invoke a skill before responding."

## What NOT to Invoke Skills For

- Pure lookup/factual questions ("what is X?", "how does Y work?")
- Single shell commands or one-line edits
- Git operations (status, log, diff, commit)
- Wiki ingests (ingest process is defined by CLAUDE.md, no skill needed)
- Continuation of in-progress work (don't re-invoke skills mid-task)
- Session start/stop messages

## Override Hierarchy

1. User explicit instruction ("skip", "just answer", "use brainstorming") — always wins
2. This file (skill-invocation.md) — overrides superpowers "1% chance" heuristic
3. superpowers/using-superpowers SKILL.md — base behavior, overridden by #1 and #2
