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

## Built-in harness roles

No custom agent roster is installed. When a harness supports built-in roles,
use its `Explore`, `Plan`, or general-purpose role with an explicit model tier.
For parallel implementation, use isolated git worktrees rather than named
custom agents.

User-specified tiers always override.
