# Canonical AgentOps Communication Plane

The canonical, human-readable implementation SPEC now lives in AgentOps:

- [`~/repos/AgentOps/Projects/20260715_agentops-canonical-communication-plane-spec.md`](file:///Users/vietquocbui/repos/AgentOps/Projects/20260715_agentops-canonical-communication-plane-spec.md)

It supersedes the older local multi-session specification:

- [`SPEC-multi-session-context-queue.md`](./SPEC-multi-session-context-queue.md)

The adopted rule is: Pi is the only **canonical** agent harness. AgentOps is the
durable communication/context source; Commandr and DiffView are Pi services;
other vendors are provider adapters or explicit bounded CLI bridges. The route
for driving Claude models from Pi is the **ACP bounded-delegate bridge** (a local
`claude-agent-acp` subprocess over stdio JSON-RPC); Pi owns canonical identity,
policy, lifecycle, approval, worktree authority, and AgentOps state, while the
subprocess owns only ephemeral delegated-turn execution. Pi never
extracts/proxies Claude Code's token.
Provider routing now has a dedicated reviewed SPEC and plan in AgentOps:

- [`~/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-spec.md`](file:///Users/vietquocbui/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-spec.md)
- [`~/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-plan.md`](file:///Users/vietquocbui/repos/AgentOps/Projects/20260716_pi-provider-harness-and-antigravity-routes-plan.md)

Locked provider decisions:

- Pi remains the sole harness and uses native, authorized custom, or ACP
  bounded-delegate routes;
- the ACP delegate is bounded and noncanonical; it uses Claude Code's own
  credential store, reports `automatic retry unknown`, and ACP cancel is a
  no-ack notification whose terminal prompt result determines outcome;
- ACP defaults load no settings/MCP/directories/tools, inherit only an allowed
  environment, and use fail-closed one-time `ctx.ui.confirm` permissions;
- finite wall-clock/turn/tool/repeat/error/permission/policy/output budgets trip
  cancel→kill with zero auto-restarts/fallback and explicit user reset;
- rollback is user-driven via `/model`; no programmatic paid-model restoration;
- native Claude subscription billing is vendor-controlled and must not be
  advertised as free/included;
- automatic cross-provider fallback is prohibited;
- Antigravity (OAuth proxy, SDK, CLI) is out of scope for v1 — not a managed
  quarantine state; re-introduction requires written Google authorization + ADR;
- credentials, prompts, tool bodies, and account identity never enter AgentOps.
