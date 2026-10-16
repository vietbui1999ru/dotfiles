# Model Routing

Classify complexity before every task and agent spawn. No silent defaults.

| Role | Model | Effort | Use for |
|---|---|---|---|
| Orchestrator (main session) | Opus 5.5 (`opus`) | `medium`; `/effort high` or `xhigh` for hard architecture or security work | Decisions, root cause, the review gate, anything with judgment |
| Light delegate | Haiku 5.5 (`claude-haiku-5-5`) | `medium` | Read-only exploration (`scout`), rote bounded edits (`worker`), lookups, shell commands |
| Implementation | high: `openai-codex/gpt-6.1-sol:high`; medium: `opencode-go/deepseek-v4-pro:high`; low: `opencode-go/deepseek-v4.1-flash:off` | per tier | Multi-file features, migrations, refactors, dispatched to Pi per `plan-handoff.md`. Same tiers as `delegate-pi` and `~/.pi/agent/routing.env` |

Sonnet 5.5 has no default role. Pass `model: sonnet` on a spawn when a task needs it.
Also available with no assigned role: `openai-codex/gpt-6-sol`, `gpt-6-luna`, `gpt-6-astra`, `gpt-5.6-terra`, and `opencode-go` `kimi-k3`, `glm-5.3`, `qwen3.8-max`.

**Escalate to the orchestrator** if any: irreversible side effects, deep multi-domain reasoning, failure hard to detect, output used as downstream ground truth.
**Delegate to Haiku** only if all: bounded, mechanical, fully specified, no judgment needed.
**Effort flag**: if a task warrants more effort than the session runs, say so and let the user decide.

## Delegating inside Claude

- Break-even: a handoff that costs as much as the edit is not a saving. Keep small, fully known changes in the main session.
- Precedence for a subagent's model: per-call `model`, then the agent's frontmatter `model`, then `CLAUDE_CODE_SUBAGENT_MODEL`, then the main model. The variable only fills gaps.
- Subagent effort is not documented to follow a model's `modelSettings`. Set `effort` in the agent's frontmatter; `scout` and `worker` do.
- Custom agents: `scout` (read-only) and `worker` (bounded edits), both Haiku 5.5 medium, are defined in `claude/.claude/agents/` but are only available where that folder is linked into `~/.claude/agents`; on a machine with a real `~/.claude/agents` folder (this one) they are not loaded, and the core agent budget is 0. `firecrawl` (web research) is linked by hand here. Otherwise use built-in `Explore`, `Plan`, or general-purpose with an explicit `model`.
- Cost reasoning and price table: wiki `concepts/subagent-cost-model`.

## Missing model

Fall back to the closest model of the same provider before crossing providers; never to one the user removed. If the fallback is below the task's minimum, halt and ask.

User-specified models and tiers always override.
