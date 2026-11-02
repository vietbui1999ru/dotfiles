---
status: approved
branch: feat/headroom
---
# SPEC: Shared Headroom pilot for Claude, Codex, and Pi

## Objective
Provide one explicitly cache-oriented local Headroom proxy with opt-in Claude,
Codex, and Pi entry points. Preserve authentication, provider identity, session
affinity, and existing configuration. Measure task outcomes and actual upstream
cache usage before recommending default adoption. Chat approval on 2026-11-02
authorizes this rollout; the separate local spec approval record remains human-owned.

Phases are sequential in one worktree, with one coherent implementation commit
per phase. Detailed subspecs live under `docs/headroom/` and the execution plan is
`docs/superpowers/plans/2026-11-02-headroom.md`.

## Acceptance Criteria
- AC-1: Phase 1 proxy entry point binds only to loopback, explicitly selects cache mode and one worker, and does not enable memory, learning, telemetry, or full message logging
  verify: `python3 scripts/tests/test_headroom_workflow.py HeadroomWorkflow.test_proxy_policy`
- AC-2: Phase 1 Claude and Codex launchers reuse the configured proxy, preserve user arguments and child exit status, and route both API and subscription endpoint forms without persistent config or instruction edits
  verify: `python3 scripts/tests/test_headroom_workflow.py HeadroomWorkflow.test_provider_launchers`
- AC-3: Phase 1 health checks fail clearly for an unavailable or unrelated listener, reject non-loopback proxy URLs, and never silently fall back to direct provider traffic
  verify: `python3 scripts/tests/test_headroom_workflow.py HeadroomWorkflow.test_proxy_validation`
- AC-4: Phase 2 Pi extension is inert unless explicitly enabled, overrides only supported provider routing fields, and preserves models, auth, compatibility, and provider identity
  verify: `node --test scripts/tests/headroom-pi.test.mjs`
- AC-5: Phase 2 opt-in Pi launcher works through existing pi-view/pueue-safe dispatch without modifying those services or storing credential values in queue commands
  verify: `python3 scripts/tests/test_headroom_workflow.py HeadroomWorkflow.test_pi_dispatch`
- AC-6: Phase 2 tests cover distinct Anthropic, OpenAI API, Codex subscription and opencode-go upstream routes with correct path joining and session-header preservation
  verify: `node --test scripts/tests/headroom-routing.test.mjs`
- AC-7: Phase 3 comparison tool separates direct, passthrough and cache-mode samples; reports cache reads/writes, uncached input, output, latency, errors and correctness; and refuses to invent missing monetary prices or subscription savings
  verify: `python3 scripts/tests/test_headroom_measure.py`
- AC-8: Phase 3 runbook includes start, health check, opt-in interactive and pueue usage, retrieval checks, rollback, and a reproducible multi-turn live comparison with explicit unverified results
  verify: manual - review docs/headroom/runbook.md and docs/headroom/pilot-results.md against phase 3 subspec; no unsupported savings claim
- AC-9: Focused Python and Node suites pass together and launcher/extension smoke tests use isolated homes and mock upstreams without paid inference
  verify: `python3 -m unittest discover -s scripts/tests -p 'test_headroom*.py' && node --test scripts/tests/headroom-*.test.mjs`

## Boundaries
### Always
- Use the existing installed Headroom 0.24.0 and Pi 1.4.0 interfaces as the compatibility baseline; document version differences.
- Keep normal claude, codex, and pi commands direct. Expose hclaude, hcodex, and hpi as explicit opt-ins.
- Prefer command-scoped Codex overrides and runtime Pi provider overrides over editing live user configuration.
- Keep proxy foreground and explicit; the operator owns its terminal/process. Default URL is http://127.0.0.1:8787.
- Keep session identifiers and cached prefixes intact. One proxy process owns replay state.
- Run focused tests with fake credentials, isolated homes and deterministic local HTTP fixtures before live trials.
- Dispatch implementation through Pi in this worktree; commit only owned paths through commit-funnel. Review each phase before the next dispatch.
- Record live checks as passed, failed, or not run with reason; distinguish API billing from subscription usage.
### Ask first
- New dependencies, upgrades, installing a login service, changing global provider defaults, global instructions, gate code, or unrelated extensions.
- Paid API experiments beyond small pilot calls, automatic cache warming, longer retention tiers, pushes, merges, and rebases.
### Never
- Run spec/ac-run approve, fabricate approval records, or approve agent-review.
- Print credentials, log full request bodies, inject secrets into queue commands, or read auth files for this implementation.
- Enable shared cross-project memory, semantic response reuse, learning, or unrelated context-tool/MCP installation as a side effect.
- Change verify lines or existing tests to make failed checks pass.

## Open Questions
- None blocking the offline implementation. Live account compatibility and savings are empirical outcomes, not assumptions.
- If installed Pi cannot preserve an upstream's auth or model-level routing through the supported override API, reject that route explicitly and report it; do not replace the provider implementation.
