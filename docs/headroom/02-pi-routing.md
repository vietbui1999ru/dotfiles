# Subspec 2: Opt-in Pi routing

Status: scoped; depends on verified phase 1. Owns root AC-4 through AC-6.

## Deliverable

Create `pi/.pi/agent/extensions/headroom.ts`, inert unless `PI_HEADROOM=1`.
Use Pi 1.4.0's documented `registerProvider(name, {baseUrl, headers})` partial
override so catalogs, OAuth, native APIs and compatibility settings survive.
Do not supply models, apiKey, oauth, or a replacement stream handler. Read
`HEADROOM_WORKFLOW_URL` with the same loopback validation policy as phase 1.

Support `anthropic`, `openai`, `openai-codex` and `opencode-go`, preserving their
provider IDs and native session/cache headers. Derive exact upstream path
behavior from installed Pi providers and Headroom handlers before implementation.
For opencode-go, use documented Headroom `x-headroom-base-url` routing with the
correct upstream base and endpoint path. Never send opencode-go credentials to
OpenAI or Anthropic by default. Reject unsupported heterogeneous/model-specific
endpoint overrides rather than silently routing them incorrectly.

Export pure routing helpers in a sibling module only if required for testing;
keep the extension small. Tests may import TypeScript using installed Node's
type stripping, avoiding added dependencies. Use type-only imports for Pi types.
An enabled extension checks readiness before allowing provider traffic; its
failure must stop startup rather than leave a partial routing setup.

Add `headroom-workflow pi`, setting child-only `PI_HEADROOM=1` and loading the
extension by explicit path through Pi's `--extension` option. Avoid loading it
twice when stow already exposes it; verify the installed loader's deduplication.
Add guarded hpi alias. For pueue, retain command structure through pi-view and
enable the extension using nonsecret `PI_HEADROOM=1` at queue creation; document
the required extension installation/path. Do not modify pi-view, pueue-safe,
provider-governance, queue templates or review hooks.

## Verification

Create `scripts/tests/headroom-pi.test.mjs` and
`scripts/tests/headroom-routing.test.mjs`. Exercise inert mode, correct provider
registrations and refusal paths with an ExtensionAPI mock, then exercise the
installed native provider request path against a local fake upstream where
practical. Assert protocol/path and upstream selection, retained session headers,
and no changes to catalog/auth fields. Stub API shape tests alone do not prove
live OAuth compatibility; record that separately in phase 3.

Extend `HeadroomWorkflow.test_pi_dispatch` to verify pi-view argument forwarding,
child-only environment and unchanged ordinary invocation. Use stubs, never the
real queue or real credentials in tests.
