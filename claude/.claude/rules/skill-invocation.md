# Skill Invocation Contract

Deterministic skill triggers (no "invoke on any chance" heuristic). User instructions always override.

**Decision**: user names skill → invoke immediately. User says "skip/just answer" → skip. Otherwise check trigger table.

## Vendored process skills

The process skills in `shared/skills` (vendored from superpowers, see `vendor.json`) follow these rules where their text conflicts:

- **TDD**: active for Web/Backend/API, DevOps, Testing, System Engineering. Skip for learning domains (Embedded, C, Go, C++, CUDA, Shaders, Interpreters, Ansible, Terraform, K8s). Exception: user explicitly requests TDD.
- **Brainstorming**: commit design docs like any other work (see "Git history" in tool-routing). Present doc path + content and ask before writing. Hard gate honored — no code until design approved.
- **Skill ordering**: this file is authoritative. Order: wiki-context → process skills → domain/implementation skills.
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

Defined once, in the `grill-me` skill itself (`shared/skills/grill-me/SKILL.md`), so every harness gets it, not only Claude. Not repeated here.

## Skip skills for

Lookups, one-liners, shell commands, git ops, wiki ingests, mid-task continuation, session start/stop.
