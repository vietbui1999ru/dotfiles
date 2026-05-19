# Model Tier Auto-Selection

Before any task — including spawning agents — classify complexity and select the appropriate model tier.
This is a strict rule. Do not default silently. Think explicitly, even if briefly.

## Decision table

| Tier | When to use |
|---|---|
| **Haiku** | Single-file edits, boilerplate, trivial rewrites, lookup/factual Q&A, shell commands, bounded subagent mechanical work |
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

## Agent spawning

When calling the `Agent` tool: always set the `model` param explicitly.
Never let it default silently — a missing `model` param is a routing decision left unmade.

```
model: "opus"   # for Opus 4.7
model: "sonnet" # for Sonnet 4.6 (default)
model: "haiku"  # for Haiku 4.5
```

## Self-check

If the task seems Opus-worthy but the current session is running Sonnet:
flag it to the user — "this task may benefit from Opus given [reason]" — and let them decide.
Do not silently proceed on Sonnet for tasks that clearly warrant Opus.
