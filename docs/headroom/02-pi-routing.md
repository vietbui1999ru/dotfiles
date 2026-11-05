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

**Measured on headroom 0.24.0 / pi 1.4.0 and implemented — this supersedes the
original `x-headroom-base-url` instruction:**

- `x-headroom-base-url` does **not** route `/v1/chat/completions`. Probed with the
  header set to the OpenCode Go base against a default-target proxy, the request
  reached `api.openai.com` carrying the OpenCode key. The header is read only by the
  catch-all `/{path:path}` route, which forwards raw and skips compression. It must
  not be used to keep opencode-go credentials at OpenCode.
- Instead the proxy pins one OpenAI-shaped target to OpenCode Go, and `opencode-go`
  gets `${base}/v1`. Both Codex clients are unaffected because the ChatGPT upstream
  is chosen by auth shape (`chatgpt-account-id` header or the JWT's
  `chatgpt_account_id` claim), not by that setting.
- `openai-codex` gets `${base}/backend-api`, not `${base}/v1`: Pi speaks WebSocket
  on base + `/codex/responses`, and `/backend-api/codex/responses` is the only WS
  route headroom registers that matches.
- Pi's `openai` provider is deliberately **not** overridden. Its API key belongs to a
  different vendor than the pinned target, so routing it is the one misroute this
  design must not create.

Never send opencode-go credentials to OpenAI or Anthropic by default. Reject
unsupported heterogeneous/model-specific endpoint overrides rather than silently
routing them incorrectly.

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

Implemented in `pi/.pi/agent/extensions/headroom.ts` and
`pi/.pi/agent/extensions/lib/headroom-routing.ts`, with the CLI side in
`scripts/headroom-workflow` (`pi` subcommand) and the `hpi` alias.

**AC-2 delta, needs a human decision:** AC-2 asks the Codex launcher to "route both
API and subscription endpoint forms". Under a pinned OpenAI target the API-key form
cannot be proxied without sending OpenAI credentials to OpenCode Go, so the launcher
now routes only the subscription surface and leaves the API-key path direct. The test
asserts that contract (passthrough for an inherited `OPENAI_BASE_URL`, refusal for a
proxy-pointed leftover). AC-2's wording therefore no longer matches the code and
should be amended or the change reverted; the AC text and its verify line were left
untouched.

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
