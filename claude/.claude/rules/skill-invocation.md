# Skill Invocation Contract

Replaces superpowers "1% chance" heuristic with deterministic triggers. User instructions always override.

**Decision**: user names skill → invoke immediately. User says "skip/just answer" → skip. Otherwise check trigger table.

## Domain Trigger Table

| Task Type | Skills (in order) | Trigger Pattern |
|---|---|---|
| Architecture, system design, multi-agent | `wiki-context` | "design", "architecture", "system", multi-component |
| Brainstorming, exploring alternatives | `wiki-context` → `brainstorming` | "what could we do", "how should we approach", "explore" |
| Debugging — test failure or unexpected behavior | `wiki-context` → `systematic-debugging` | errors, failing tests, "why is this broken" |
| Security review | `wiki-context` → `security-review` | security, auth, injection, permissions, credentials |
| Multi-step implementation (3+ deliverables) | `wiki-context` | feature build, migration, refactor spanning files |
| Post-generation: code/plan/design | `/judge` (AFTER generating) | 20+ lines of code, numbered plan, architecture decisions |

**Order when multiple apply**: wiki-context → process skills (brainstorming, debugging) → implementation skills.

## Skip skills for

Lookups, one-liners, shell commands, git ops, wiki ingests, mid-task continuation, session start/stop.
