# Skill Invocation Contract

Replaces superpowers "1% chance" heuristic with deterministic triggers. User instructions always override.

**Decision**: user names skill → invoke immediately. User says "skip/just answer" → skip. Otherwise check trigger table.

## Superpowers integration

These overrides apply where superpowers defaults conflict with personal rules:

- **TDD**: active for Web/Backend/API, DevOps, Testing, System Engineering. Skip for learning domains (Embedded, C, Go, C++, CUDA, Shaders, Interpreters, Ansible, Terraform, K8s). Exception: user explicitly requests TDD.
- **Brainstorming**: NEVER auto-commit. Present doc path + content, ask before writing or committing. Hard gate honored — no code until design approved.
- **Skill ordering**: this file is authoritative. Order: wiki-context → superpowers process skills → domain/implementation skills.
- **Caveman + artifacts**: core.md's caveman section is single source of truth. Skill artifacts on disk use clear prose.
- **Agent spawns** (writing-plans and any parallel dispatch): always set an explicit `model:` param per model routing policy.

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

## grill-me — relaxed mode

When a written spec is present (GitHub issue body, PRD, CLAUDE.md section, detailed chat message) and `grill-me` would trigger, prepend one line before the first question:

> "Spec detected — say 'just do it' to skip questions and self-generate."

If user opts out ("just do it", "no questions", "skip the grill"):
- Ask at most **one** question — only a true blocker that cannot be inferred from the spec, codebase, or CLAUDE.md
- If no true blocker exists, proceed silently
- Everything inferable from spec + codebase is resolved without asking

## Skip skills for

Lookups, one-liners, shell commands, git ops, wiki ingests, mid-task continuation, session start/stop.
