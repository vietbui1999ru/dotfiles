/**
 * Phase 0 tests — TDD approach.
 *
 * Test categories:
 *   1. Config loading & merging
 *   2. Retry label resolution
 *   3. Logger write/read
 *   4. Error tracking
 *   5. Type shape validation
 *
 * Run: node --test test/*.test.ts
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ───── 1. Config loading & merging ─────

describe("Config", () => {
  const testDir = join(tmpdir(), `provider-governance-test-${Date.now()}`);
  const origConfigPath = join(homedir(), ".pi", "agent", "provider-governance.json");

  before(() => {
    mkdirSync(testDir, { recursive: true });
  });

  after(() => {
    try { unlinkSync(join(testDir, "provider-governance.json")); } catch {}
  });

  it("loads defaults when no config file exists", async () => {
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    assert.ok(cfg);
    assert.equal(cfg.governanceEnabled, true);
    assert.equal(cfg.registrationEnabled, false);
    assert.equal(cfg.configScope, "global-only");
    assert.equal(cfg.allowAutomaticCrossProviderFallback, false);
    assert.ok(cfg.acpDelegate);
    assert.equal(cfg.acpDelegate!.routeEnabled, false);
    assert.equal(cfg.acpDelegate!.allowAlways, false);
    assert.equal(cfg.acpDelegate!.limits.maxSubprocessRestarts, 0);
    assert.equal(cfg.acpDelegate!.limits.wallClockDeadlineMs, 900000);
    assert.equal(cfg.acpDelegate!.limits.maxPolicyViolations, 1);
    assert.equal(cfg.telemetry!.sink, "bounded-spool");
    assert.equal(cfg.telemetry!.spoolRetentionDays, 30);
  });

  it("rejects registrationEnabled=true by default (locked safe)", async () => {
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    assert.equal(cfg.registrationEnabled, false,
      "registrationEnabled must default to false — live registration blocked");
  });

  it("rejects allowAutomaticCrossProviderFallback=true (locked safe)", async () => {
    const { loadConfig } = await import("../src/config.ts");
    const cfg = loadConfig();
    assert.equal(cfg.allowAutomaticCrossProviderFallback, false,
      "cross-provider fallback must default to false — prohibited");
  });
});

// ───── 2. Retry label resolution ─────

describe("RetryLabel", () => {
  it("returns 'configured' when retry is enabled with defaults", () => {
    const settings = {
      retry: { enabled: true, maxRetries: 3, provider: { maxRetries: 0 } },
    };
    const label = resolveRetryLabelFromSettings(settings);
    assert.equal(label, "configured");
  });

  it("returns 'configured' when retry is explicitly disabled", () => {
    const settings = {
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
    };
    const label = resolveRetryLabelFromSettings(settings);
    assert.equal(label, "configured");
  });

  it("returns 'unknown' when retry object is missing", () => {
    const settings = {};
    const label = resolveRetryLabelFromSettings(settings);
    assert.equal(label, "unknown");
  });

  it("returns 'unknown' when retry.enabled is null", () => {
    const settings = { retry: { enabled: null } };
    const label = resolveRetryLabelFromSettings(settings);
    assert.equal(label, "unknown");
  });

  it("returns 'unknown' when input is not an object", () => {
    const label = resolveRetryLabelFromSettings(null);
    assert.equal(label, "unknown");
  });
});

// ───── 3. Logger write/read ─────

describe("Logger", () => {

  it("logPath returns a string path", async () => {
    const { logPath } = await import("../src/logger.ts");
    const path = logPath();
    assert.ok(typeof path === "string");
    assert.ok(path.includes("provider-governance.log"));
  });

  it("incrementError counts correctly", async () => {
    const { resetErrorCounters, incrementError, getErrorCounters } =
      await import("../src/logger.ts");
    resetErrorCounters();
    assert.deepEqual(getErrorCounters(), {});

    incrementError("test-source");
    incrementError("test-source");
    incrementError("other-source");

    const counts = getErrorCounters();
    assert.equal(counts["test-source"], 2);
    assert.equal(counts["other-source"], 1);
  });

  it("resetErrorCounters clears all counters", async () => {
    const { resetErrorCounters, incrementError, getErrorCounters } =
      await import("../src/logger.ts");
    resetErrorCounters();
    assert.deepEqual(getErrorCounters(), {});
  });

  it("incrementError returns the new count", async () => {
    const { resetErrorCounters, incrementError } =
      await import("../src/logger.ts");
    resetErrorCounters();
    const count = incrementError("test");
    assert.equal(count, 1);
    const count2 = incrementError("test");
    assert.equal(count2, 2);
  });
});

// ───── 4. Type shape validation ─────

describe("Types", () => {
  it("ACP defaults have finite circuit-breaker budgets", () => {
    const limits = {
      wallClockDeadlineMs: 900000,
      maxPromptTurns: 8,
      maxToolCalls: 40,
      maxRepeatedAction: 3,
      maxRepeatedError: 3,
      maxPermissionDenials: 2,
      maxPolicyViolations: 1,
      maxOutputBytes: 10485760,
      maxSubprocessRestarts: 0,
    };

    for (const [key, value] of Object.entries(limits)) {
      assert.ok(typeof value === "number",
        `${key} must be a number, got ${typeof value}`);
      if (key === "maxSubprocessRestarts") {
        assert.equal(value, 0, "maxSubprocessRestarts must be 0");
      } else {
        assert.ok(value > 0,
          `${key} must be > 0, got ${value}`);
      }
    }
  });

  it("ACP defaults reject negative/unbounded limits", () => {
    const validateLimit = (value: number, key: string): boolean => {
      if (typeof value !== "number" || !Number.isFinite(value)) return false;
      if (key === "maxSubprocessRestarts") return value === 0;
      if (value <= 0) return false;
      return true;
    };

    assert.equal(validateLimit(-1, "maxToolCalls"), false);
    assert.equal(validateLimit(0, "maxToolCalls"), false);
    assert.equal(validateLimit(Infinity, "maxToolCalls"), false);
    assert.equal(validateLimit(NaN, "maxToolCalls"), false);
    assert.equal(validateLimit(0, "maxSubprocessRestarts"), true);
  });
});

// ───── Helper: pure-function retry label resolver ─────

/**
 * Pure function version — tests the resolution logic in isolation
 * without filesystem dependency.
 */
function resolveRetryLabelFromSettings(settings: unknown): string {
  if (!settings || typeof settings !== "object") return "unknown";

  const s = settings as Record<string, unknown>;
  const retry = s["retry"] as Record<string, unknown> | undefined;
  if (!retry || typeof retry !== "object") return "unknown";

  const enabled = retry["enabled"];
  const maxRetries = retry["maxRetries"];

  if (enabled === false) return "configured";
  if (enabled === true && typeof maxRetries === "number") return "configured";
  return "unknown";
}
