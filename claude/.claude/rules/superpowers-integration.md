# Superpowers Integration Rules

Overrides superpowers defaults where they conflict with personal rules.

**TDD**: Active for Web/Backend/API, DevOps, Testing, System Engineering. Skip for learning domains (Embedded, C, Go, C++, CUDA, Shaders, Interpreters, Ansible, Terraform, K8s). Exception: user explicitly requests TDD.

**Brainstorming auto-commit**: NEVER auto-commit. Present doc path + content, ask before writing or committing.

**Skill ordering**: skill-invocation.md is authoritative. Order: wiki-context → superpowers process skills → domain/implementation skills. Replaces "1% chance" heuristic.

**Caveman + artifacts**: caveman-mode.md is single source of truth. Skill artifacts on disk use clear prose.

**Brainstorming hard-gate**: honored — no code until design approved.

**Partial skills** (writing-plans, subagent-driven-development, dispatching-parallel-agents): always set explicit `model:` param on Agent spawns per model-routing.md.

| Skill | Status |
|---|---|
| `brainstorming` | override: no auto-commit |
| `test-driven-development` | override: domain exclusion |
| `writing-plans` | partial: explicit model param |
| `subagent-driven-development` | partial: explicit model param |
| `dispatching-parallel-agents` | partial: explicit model param |
| all others | no conflict |
