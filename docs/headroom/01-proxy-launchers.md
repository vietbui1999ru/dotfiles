# Subspec 1: Shared proxy and provider launchers

Status: scoped; execution requires the human-owned root SPEC approval record.
Owns root AC-1 through AC-3. Prerequisite: installed Headroom 0.24.0.

## Deliverable

Create `scripts/headroom-workflow`, a stdlib Python CLI with `proxy`, `status`,
`claude`, `codex`, and (in phase 2) `pi` subcommands. Accept
`HEADROOM_WORKFLOW_URL`, default `http://127.0.0.1:8787`; allow only loopback hosts,
HTTP, explicit valid port, and no credentials, query, fragment or path suffix.
Resolve binaries on PATH and fail with a useful recovery command if missing.

`proxy` executes `headroom proxy --host 127.0.0.1 --port <port> --mode cache
--workers 1 --no-cache --no-telemetry`. Here `--no-cache` disables semantic
response caching, not upstream prefix caching. Do not start a background daemon
or terminate any existing listener. Refuse a pre-existing listener with a clear
message. `status` probes Headroom's documented health/identity endpoints with a
short timeout and reports readiness without dumping sensitive stats. Confirm the
installed endpoint schema before selecting the identity check.

Installed schema confirmed: GET `/livez` includes service `headroom-proxy`,
alive and version; GET `/readyz` includes service, ready and version, returning
503 when unhealthy. GET `/health` returns HTTP 200 even when unhealthy, so an
HTTP status alone is insufficient. Check identity and readiness before launching
clients; this prevents accidental routing to an unrelated listener, not a hostile
local process able to impersonate Headroom. Disable redirects in health probes.
Reject inherited settings that enable forbidden features or route to a different
upstream, unless the launcher explicitly neutralizes them in the child environment.

`claude` and `codex` require healthy Headroom first and execute the real binary
with arguments preserved as an argv list, never a shell string. Claude uses a
child-only ANTHROPIC_BASE_URL. Codex uses command-scoped config overrides for
the built-in OpenAI base URL and, if required by installed Codex, the subscription
base URL. Confirm both SSE and WebSocket paths. Preserve native auth; do not
invent dummy keys or change accounts. Refuse conflicting user routing overrides
rather than silently bypassing the proxy. Do not call `headroom wrap`, since it
also writes global configuration and can install context tools.

Replace the existing guarded hclaude alias and add hcodex in
`zsh/.zsh/aliases.zsh`, pointing at the stow-managed script path
`$HOME/dotfiles/scripts/headroom-workflow`. Do not change normal provider aliases.

## Verification and rollback

Create `scripts/tests/test_headroom_workflow.py` using unittest, temporary HOME,
stub executables and a loopback HTTP fixture. Test exact child argv/environment,
exit status, unavailable and unrelated services, conflicting routing arguments,
invalid URLs and unchanged home/config/instruction fixture bytes. Test both API
and subscription Codex overrides rather than merely asserting one env var.

No live config writes means rollback is using the original command. Operator
stops only the foreground proxy they started, using Ctrl+C. No process killing
or user-config restoration helper is needed.
