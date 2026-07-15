# Canonical AgentOps Communication Plane

The canonical, human-readable implementation SPEC now lives in AgentOps:

- [`~/repos/AgentOps/Projects/20260715_agentops-canonical-communication-plane-spec.md`](file:///Users/vietquocbui/repos/AgentOps/Projects/20260715_agentops-canonical-communication-plane-spec.md)

It supersedes the older local multi-session specification:

- [`SPEC-multi-session-context-queue.md`](./SPEC-multi-session-context-queue.md)

The adopted rule is: Pi is the only supported agent harness. AgentOps is the
durable communication/context source; Commandr and DiffView are Pi services;
other vendors are provider adapters or explicit bounded CLI bridges.
It includes the Antigravity provider phase:

- explicit Google Antigravity vs Anthropic subscription distinction;
- opt-in legal/safety gate;
- local `antigravity-claude-proxy` spike;
- Pi `anthropic-messages` custom provider;
- dynamic `/v1/models` discovery;
- `/health`, `/account-limits`, and `/v1/messages` verification;
- no silent paid-provider fallback;
- official `agy` CLI/ACP integration only if a documented stable protocol exists;
- no OAuth token extraction or undocumented endpoint reverse engineering.
