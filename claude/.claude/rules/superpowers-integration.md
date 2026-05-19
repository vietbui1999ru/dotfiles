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

When multiple skills apply, invoke in this order:
1. wiki-context (load relevant wiki knowledge first)
2. superpowers process skills (brainstorming, debugging, tdd, etc.)
3. domain/implementation skills (frontend-design, feature-dev, etc.)

wiki-context satisfies superpowers' "invoke a skill before responding" requirement.

## Caveman mode + skill artifacts

Caveman compression applies to: all Claude commentary, explanations, summaries around skills.
Caveman does NOT apply to: plan docs, design specs, skill artifacts written to disk — use clear prose (per communication.md exemptions).

## Brainstorming hard-gate

The brainstorming HARD-GATE (no code until design approved) is honored.
It aligns with core.md ("prefer small, focused outputs") — no conflict.
