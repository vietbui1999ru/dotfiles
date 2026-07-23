# Phase 2 Completion — Isolated Mock Conformance

Completed: 2026-07-23

## Test Evidence

```text
npm run typecheck   ✓ src + scripts/tests
npm run conformance ✓ 24 tests
npm test            ✓ 113 tests / 22 suites
```

No live provider, native auth, paid inference, or non-loopback endpoint was used.

## Deliverables

```text
test/
  mock-anthropic-server.ts       # loopback Anthropic Messages/SSE server
  mock-acp-agent.ts              # offline ACP JSON-RPC mock
  test-provider-extension.ts     # test-only mock-anthropic Pi provider
  phase-2-fixtures.ts            # 27-fixture terminal-state matrix
  phase-2-conformance.test.ts    # HTTP + real Pi RPC conformance
  phase-2-acp-mock.test.ts       # ACP lifecycle/cancel/death tests
```

## Mock Anthropic Coverage

- `GET /v1/models` discovery and model removal
- text and multiline streaming
- thinking and thinking signatures
- single and multiple tool calls
- Unicode/emoji and image request input
- early, late, absent, and inconsistent usage
- large and oversized response fixtures
- abort and disconnect-before/mid-stream transport failures
- 401/403/404/429/500 authoritative failures
- malformed JSON and malformed SSE
- slow headers and slow streams
- redirect inspection
- assistant/tool history handoff preservation
- request capture: method, path, headers, and body

## Pi Integration Coverage

The test-only extension:

- registers exactly one `mock-anthropic` provider through Pi's real registry;
- uses `api: "anthropic-messages"`;
- lists both mock models through `pi --list-models`;
- routes an RPC prompt to the loopback server;
- never calls `pi.setModel()`;
- has no native credentials or provider registration;
- installs a test-only global fetch guard that rejects non-loopback hosts.

The RPC harness uses:

- fresh `PI_CODING_AGENT_DIR` per run;
- `PI_OFFLINE=1`;
- `PI_SKIP_VERSION_CHECK=1`;
- explicit test extension, provider, and model;
- localhost-only mock endpoint;
- SIGTERM after `agent_settled` (exit 143 is expected harness shutdown).

## ACP Mock Coverage

The ACP mock verifies:

- `initialize` and `session/new`;
- normal `session/prompt` → `end_turn`;
- `session/cancel` has no acknowledgement and terminal prompt result is authoritative;
- process death produces no terminal prompt result, preserving `outcome-unknown`.

## Terminal-State Matrix

Every Phase 2 fixture is mapped in `phase-2-fixtures.ts` to one of:

- `completed`
- `failed`
- `outcome-unknown`

The matrix follows the normative transport classification in provider SPEC §6.5.

## Boundary / Residual Risk

The test extension provides a process-level `globalThis.fetch` loopback guard.
OS-level network namespace/packet filtering is platform-dependent and is not
silently claimed by `PI_OFFLINE=1`; a future CI runner may add `unshare -n`,
container networking, or an equivalent host egress policy.

No live remote custom provider is enabled. Phase 4 remains blocked on retry
control, authorization provenance, this conformance suite, and the Phase 5
AgentOps sink or bounded spool.

## Manual Smoke Test

A human-readable smoke test is available:

```sh
cd ~/.pi/agent/extensions/provider-governance
npm ci --ignore-scripts
npm run manual:phase2
npm run manual:phase2 -- thinking-signature
npm run manual:phase2 -- multiple-tool-calls
```

It prints PASS/FAIL for model registration, a real Pi RPC prompt, loopback
request capture, and the selected scenario. It uses a fresh agent directory and
never uses native auth.

## Next Phase

Phase 3 — observation-first provider governance:

- provider status/doctor/policy commands against the real model registry;
- model selection and terminal-message observation;
- advisory billing/authorization/retry labels;
- no provider re-registration, login automation, `pi.setModel()`, or inference routing.
