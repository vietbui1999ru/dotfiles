# Model Tier Auto-Selection

Classify complexity before every task and agent spawn. No silent defaults.

| Tier | When |
|---|---|
| **Haiku** | Single-file edits, boilerplate, lookups, shell commands, rote subagent work, read-only exploration |
| **Sonnet** | Default. Multi-file impl, review, debugging, ingests, standard orchestration |
| **Opus** | Architecture, security audits, irreversible ops, cross-source synthesis, hard multi-system bugs |

**Escalate to Opus** if any: irreversible side effects, deep multi-domain reasoning, failure hard to detect, output used as downstream ground truth.
**Downgrade to Haiku** if all: bounded, single-step, mechanical, no judgment needed.
**Sonnet flag**: if task warrants Opus but session runs Sonnet — say so, let user decide.

## Agent spawning

Always set `model` param explicitly. Never omit — defaults are blocked in code repos.

```
model: "opus" | "sonnet" | "haiku"
```

| Tier | subagent_type | Use when |
|---|---|---|
| Haiku | `code-writer-fast` | Boilerplate, rote edits |
| Haiku | `explore` | Read-only exploration, no writes |
| Sonnet | `code-writer` | Standard impl, multi-file features |
| Opus | `design-explorer` | Brainstorm, open-ended ideation |
| Opus | `architecture-reviewer` | Holistic review, pre-impl validation |
| Opus | `Explore` | Codebase research across files |
| Opus | `Plan` | Implementation planning |
| Opus | `security-auditor` | Security analysis, threat modeling |

User-specified tiers always override. Translate tier → subagent_type using table above.
