# Phase 0 Completion — Provider Governance

Completed: 2026-07-23

## Deliverables

### 1. Retry Behavior Confirmed

Confirmed through review of Pi 0.80.10 docs:

| Setting | Default | Notes |
|---------|---------|-------|
| `retry.enabled` | `true` | Agent-level transient error retry |
| `retry.maxRetries` | `3` | Max agent-level retry attempts |
| `retry.baseDelayMs` | `2000` | Exponential backoff base |
| `retry.provider.maxRetries` | `0` | Provider/SDK retries (disabled by default) |
| `retry.provider.maxRetryDelayMs` | `60000` | Cap on server-requested delay |

Precedence: Global `~/.pi/agent/settings.json` → Project `.pi/settings.json` (trust-gated).

### 2. RPC Retry Probe Built

`scripts/rpc-retry-probe.ts` — spawns Pi in RPC mode with isolated `PI_CODING_AGENT_DIR`,
sends a prompt, and captures `auto_retry_start`/`auto_retry_end` events from RPC stdout.
Runs with both `retry.enabled=true` and `retry.enabled=false`.

**Key finding:** Extension API has NO retry lifecycle events. Retry observation requires
an RPC stdout bridge. This is documented in the probe's output and in the extension's
`/provider-doctor` and `/provider-status` commands.

### 3. Extension Skeleton

```
~/.pi/agent/extensions/provider-governance/
  package.json             — pinned deps (pi@0.80.10)
  package-lock.json        — integrity-pinned (3588 lines)
  tsconfig.json            — strict TS, ES2022
  tsconfig.scripts.json    — for scripts/ and test/
  src/
    index.ts               — observation-only extension (5 commands)
    config.ts              — config loader for provider-governance.json
    types.ts               — all type definitions
    logger.ts              — structured log/error tracking
  scripts/
    rpc-retry-probe.ts     — RPC retry observation probe
  test/
    phase-0.test.ts        — 14 tests (config, retry label, logger, types)
    phase-0-extended.test.ts — 20 tests (persistence, edge cases, validation)
```

### 4. Global Config

`~/.pi/agent/provider-governance.json` with locked defaults:
- `governanceEnabled: true`
- `registrationEnabled: false` (live registration blocked)
- `acpDelegate.routeEnabled: false`
- All circuit-breaker limits set per spec

### 5. Commands Registered

| Command | Description |
|---------|-------------|
| `/provider-status` | Provider inventory, retry policy, ACP status |
| `/provider-doctor` | Observational diagnostics (no inference) |
| `/provider-policy` | Cross-provider fallback, config scope, ACP settings |
| `/provider-logs` | Recent log entries with error counters |
| `/provider-logs-clear` | Clear the log file |

### 6. Error Tracking (Logger)

`src/logger.ts` provides structured logging:

- **Log file:** `~/.pi/agent/provider-governance.log` (JSONL, append-only)
- **Levels:** DEBUG, INFO, WARN, ERROR
- **Error counters:** Per-source `incrementError()` with `getErrorCounters()` / `resetErrorCounters()`
- **Stderr echo:** ERROR and WARN entries echo to stderr for Pi's crash log visibility
- **Recent logs:** `readRecentLogs(n)` retrieves last N entries for diagnostics
- **Controls:** `PROVIDER_GOVERNANCE_LOG_LEVEL` env var (default: INFO)
- **Safe:** Logger never throws — failures go to stderr as last resort

### 7. TDD Results

```
34 tests across 9 suites — all pass
  Config          ✓ 3  (defaults, registration blocked, fallback blocked)
  RetryLabel      ✓ 5  (configured/unknown, edge cases)
  Logger          ✓ 8  (path, counters, persistence, ERROR serialization)
  Types           ✓ 7  (circuit-breaker validation, edge cases)
  Retry edge      ✓ 5  (empty, malformed, non-object)
  Config I/O      ✓ 3  (path, defaults, writeConfig)
  Error tracking  ✓ 3  (sequential counts, snapshot, reset)
```

### 8. Typecheck

Both `tsconfig.json` (src/) and `tsconfig.scripts.json` (scripts/) pass clean.

### 9. Extension Loads

`pi -e .../provider-governance/src/index.ts --list-models` confirms:
```
[provider-governance] Phase 0 loaded. Config: .../provider-governance.json
```
And the INFO entry is persisted to `provider-governance.log`.

### 10. Findings

**Live remote custom registration remains BLOCKED** — Pi 0.80.x extension API cannot
prove effective retry state at runtime. The extension reports `configured | unknown`
from parsed settings, not actually observed retries.

**ACP delegate is NOT blocked** — retry reported `automatic retry unknown` via RPC.

## Next Steps (Phase 1)

- Provider domain model — already started in `types.ts`
- Parse global config — already started in `config.ts`
- Add authorization-provenance types for remote endpoints
- ACP isolation defaults and circuit-breaker config validation
- Test: invalid/expired auth fails closed
- Test: untrusted project config cannot enable providers
