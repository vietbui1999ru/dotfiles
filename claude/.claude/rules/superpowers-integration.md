# Superpowers Integration Rules

Resolves conflicts between superpowers plugin and personal rules.
Priority: these rules OVERRIDE superpowers defaults where they conflict.

## TDD domain exclusion

TDD discipline (superpowers:test-driven-development) is ACTIVE in:
- Web/Backend/API, DevOps, Testing/Scripting, System Engineering

TDD discipline is SKIPPED in learning domains:
- Embedded, C, Go, C++, CUDA, Shaders, Interpreters, Ansible, Terraform, Kubernetes
- In these domains: small examples only, no test-first discipline (see learning.md)
- Exception: if user explicitly requests TDD in a learning domain, apply it

## Brainstorming auto-commit: disabled

Superpowers brainstorming skill writes a design doc to `docs/superpowers/specs/` and auto-commits.
Override: NEVER auto-commit. Present the design doc path and content, then ask before writing or committing.
Applies to: all brainstorming outputs, plan files, spec files.

## Skill invocation ordering

Authority: `~/.claude/rules/skill-invocation.md` (single source of truth for when to invoke skills).
Ordering when multiple skills apply:
1. wiki-context (load relevant wiki knowledge first)
2. superpowers process skills (brainstorming, debugging, tdd, etc.)
3. domain/implementation skills (frontend-design, feature-dev, etc.)

`skill-invocation.md` satisfies superpowers' "invoke a skill before responding" requirement.
Its domain trigger table replaces the probabilistic "1% chance" heuristic.

## Caveman mode + skill artifacts

Exemptions defined in `~/.claude/rules/caveman-mode.md` (single source of truth). Skill artifacts written to disk (plan docs, design specs, SKILL.md) are exempt — use clear prose.

## Brainstorming hard-gate

The brainstorming HARD-GATE (no code until design approved) is honored.
It aligns with core.md ("prefer small, focused outputs") — no conflict.

## Superpowers skill audit (2026-05-24)

Status of all superpowers skills vs. personal rules:

| Skill | Conflict? | Notes |
|---|---|---|
| `brainstorming` | Override applied | No auto-commit (see above) |
| `test-driven-development` | Override applied | Domain exclusion (see above) |
| `verification-before-completion` | No conflict | Extends editing.md DoD in same direction — use it |
| `finishing-a-development-branch` | No conflict | Covers workflow not defined in personal rules — use it |
| `writing-plans` | Partial | Plan save path OK; subagent execution step must use explicit `model:` param per model-routing.md |
| `executing-plans` | No conflict | Aligns with personal rules ("never start on main without consent") |
| `subagent-driven-development` | Partial | Must set explicit `model:` param on any Agent spawns per model-routing.md |
| `systematic-debugging` | No conflict | Aligns with editing.md ("identify root cause before fix") |
| `using-git-worktrees` | No conflict | Compatible with isolation strategy |
| `requesting-code-review` | No conflict | No coverage in personal rules |
| `receiving-code-review` | No conflict | No coverage in personal rules |
| `dispatching-parallel-agents` | Partial | Agent spawns must use explicit `model:` param |
| `writing-skills` | No conflict | No coverage in personal rules |

**Rule for "Partial" skills:** Personal model-routing.md governs model tier. When any superpowers skill spawns agents, Claude must set explicit `model:` param — the skill itself does not specify this.
