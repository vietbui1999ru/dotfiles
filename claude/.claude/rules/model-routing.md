# Model Tier Auto-Selection

Before any task — including spawning agents — classify complexity and select the appropriate model tier.
This is a strict rule. Do not default silently. Think explicitly, even if briefly.

## Decision table

| Tier | When to use |
|---|---|
| **Haiku** | Single-file edits, boilerplate, trivial rewrites, lookup/factual Q&A, shell commands, bounded subagent mechanical work, **read-only exploration** (filesystem traversal, symbol lookup, codebase mapping — use `explore` agent) |
| **Sonnet** | Default. Multi-file implementation, code review, debugging, wiki ingests, multi-step workflows, standard orchestration |
| **Opus** | Architecture design, security audits, hard debugging (multiple interacting systems), cross-source synthesis, irreversible decisions, high-stakes analysis |

## Auto-selection rule

Start at **Sonnet**. Then ask two questions:

1. **Escalate to Opus?** — Yes if any of:
   - Task involves irreversible side effects (deploys, schema migrations, destructive git ops)
   - Deep multi-domain reasoning required (security threat model, agent harness design, cross-source synthesis)
   - Failure is expensive and hard to detect (subtle logic bugs, auth flows, evaluation pipelines)
   - Output will be used as ground truth by downstream agents

2. **Downgrade to Haiku?** — Yes if all of:
   - Clearly bounded, single-step, mechanical
   - No judgment call required — output is deterministic or easily verified
   - Subagent doing rote work (rename, format, lookup, boilerplate generation)
   - **Read-only exploration**: task is purely "find/read/map" with no modification — delegate to `explore` agent (Haiku, disallowed Write/Edit)

## Agent spawning

When calling the `Agent` tool: always set the `model` param explicitly.
Never let it default silently — a missing `model` param is a routing decision left unmade.

```
model: "opus"   # for Opus 4.7
model: "sonnet" # for Sonnet 4.6 (default)
model: "haiku"  # for Haiku 4.5
```

### Tier → subagent_type mapping (fixed)

Every Agent call must use a whitelisted `subagent_type`. Never use `claude`, `general-purpose`, or omit it — those are blocked in code repos.

| Tier | subagent_type | Use when |
|---|---|---|
| **Haiku** | `code-writer-fast` | Boilerplate, scaffolding, simple utilities, rote edits |
| **Haiku** | `explore` | Read-only filesystem/codebase exploration — no writes allowed |
| **Sonnet** | `code-writer` | Standard implementation, multi-file features, refactors |
| **Opus** | `design-explorer` | Brainstorm, explore alternatives, open-ended ideation |
| **Opus** | `architecture-reviewer` | Holistic review, structural assessment, pre-implementation validation |
| **Opus** | `Explore` | Codebase research, symbol/pattern lookup across files |
| **Opus** | `Plan` | Implementation planning, task breakdown, approach design |
| **Opus** | `security-auditor` | Security analysis, threat modeling |

Specialist agents (debugging, devops, review) keep their own tier as documented in agent-delegator — this table covers the common direct-spawn cases.

### Prompt-specified tiers

When the user says "use Opus to research, Sonnet to implement, Haiku for boilerplate" — honor it directly. User-specified tiers override auto-selection. Translate tier → subagent_type using the table above.

## Self-check

If the task seems Opus-worthy but the current session is running Sonnet:
flag it to the user — "this task may benefit from Opus given [reason]" — and let them decide.
Do not silently proceed on Sonnet for tasks that clearly warrant Opus.
