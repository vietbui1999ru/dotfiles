/**
 * Phase 0 tests — extended coverage for logging and config persistence.
 *
 * Run: node --test test/*.test.ts
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, unlinkSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir, tmpdir } from "node:os";

// ───── 1. Logger write/read round-trip ─────

describe("Logger — persistence", () => {
  const LOG_PATH = join(tmpdir(), `provider-governance-persist-test-${Date.now()}`, "test.log");
  let logger: typeof import("../src/logger.ts");

  before(async () => {
    mkdirSync(join(tmpdir(), `provider-governance-persist-test-${Date.now()}`), { recursive: true });
    logger = await import("../src/logger.ts");
  });

  beforeEach(() => {
    logger.resetErrorCounters();
  });

  it("writes INFO entry that appears in recent logs", () => {
    logger.info("test-source", "hello from test", { key: "val" });
    const logs = logger.readRecentLogs(10);
    const found = logs.find(
      (l: { source: string; message: string }) =>
        l.source === "test-source" && l.message === "hello from test",
    );
    assert.ok(found, "expected log entry not found");
    assert.equal(found!.level, "INFO");
  });

  it("writes ERROR entry with error serialization", () => {
    const testError = new Error("boom");
    logger.error("err-source", "something broke", testError);
    const logs = logger.readRecentLogs(10);
    const found = logs.find(
      (l: { source: string }) => l.source === "err-source",
    );
    assert.ok(found, "expected ERROR entry not found");
    assert.equal(found!.level, "ERROR");
    assert.ok(found!.error, "error field should be set");
    assert.ok(found!.error!.includes("boom"), `error should contain message: ${found!.error}`);
  });

  it("WARN increments error counter", () => {
    logger.resetErrorCounters();
    logger.warn("warn-src", "warning message");
    const counters = logger.getErrorCounters();
    assert.equal(counters["warn-src"], 1);
  });

  it("clearLog empties the log file", () => {
    logger.info("test", "before clear");
    logger.clearLog();
    const logs = logger.readRecentLogs(10);
    // At minimum the file should be empty
    assert.ok(logs.length === 0 || logs.every((l: { source: string }) => l.source !== "test"));
  });
});

// ───── 2. Config file creation ─────

describe("Config — file I/O", () => {
  let config: typeof import("../src/config.ts");

  before(async () => {
    config = await import("../src/config.ts");
  });

  it("configPath returns a non-empty string", () => {
    const p = config.configPath();
    assert.ok(typeof p === "string");
    assert.ok(p.length > 0);
    assert.ok(p.includes("provider-governance.json"));
  });

  it("loadConfig returns valid defaults without crashing", () => {
    const cfg = config.loadConfig();
    assert.ok(cfg);
    assert.ok(typeof cfg.governanceEnabled === "boolean");
    assert.ok(typeof cfg.registrationEnabled === "boolean");
    assert.ok(cfg.acpDelegate !== undefined);
  });

  it("writeConfig does not throw", () => {
    const cfg = config.loadConfig();
    assert.doesNotThrow(() => config.writeConfig(cfg));
  });
});

// ───── 3. Error counter lifecycle ─────

describe("Error tracking", () => {
  let logger: typeof import("../src/logger.ts");

  before(async () => {
    logger = await import("../src/logger.ts");
  });

  beforeEach(() => {
    logger.resetErrorCounters();
  });

  it("incrementError returns sequential counts", () => {
    assert.equal(logger.incrementError("a"), 1, "first call returns 1");
    assert.equal(logger.incrementError("a"), 2, "second call returns 2");
    assert.equal(logger.incrementError("b"), 1, "new label starts at 1");
  });

  it("getErrorCounters returns a snapshot", () => {
    logger.incrementError("x");
    logger.incrementError("x");
    logger.incrementError("y");
    const snap = logger.getErrorCounters();
    assert.deepEqual(snap, { x: 2, y: 1 });
  });

  it("resetErrorCounters clears everything", () => {
    logger.incrementError("x");
    logger.incrementError("y");
    logger.resetErrorCounters();
    assert.deepEqual(logger.getErrorCounters(), {});
  });
});

// ───── 4. Type validation edge cases ─────

describe("ACP circuit breaker — validation logic", () => {
  const VALID_LIMITS = {
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

  function validateLimit(value: number, key: string): boolean {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (key === "maxSubprocessRestarts") return value === 0;
    return value > 0;
  }

  it("all valid limits pass validation", () => {
    for (const [key, value] of Object.entries(VALID_LIMITS)) {
      assert.ok(validateLimit(value, key), `${key}=${value} should be valid`);
    }
  });

  it("rejects negative values", () => {
    for (const key of Object.keys(VALID_LIMITS)) {
      if (key === "maxSubprocessRestarts") continue; // only 0 is valid
      assert.equal(validateLimit(-1, key), false, `-1 for ${key}`);
    }
  });

  it("rejects zero for non-restart limits", () => {
    const nonRestart = Object.keys(VALID_LIMITS).filter(k => k !== "maxSubprocessRestarts");
    for (const key of nonRestart) {
      assert.equal(validateLimit(0, key), false, `0 for ${key}`);
    }
  });

  it("rejects non-finite values", () => {
    for (const key of Object.keys(VALID_LIMITS)) {
      assert.equal(validateLimit(Infinity, key), false, `Infinity for ${key}`);
      assert.equal(validateLimit(NaN, key), false, `NaN for ${key}`);
    }
  });

  it("accepts only 0 for maxSubprocessRestarts", () => {
    assert.equal(validateLimit(0, "maxSubprocessRestarts"), true);
    assert.equal(validateLimit(1, "maxSubprocessRestarts"), false);
  });
});

// ───── 5. Retry label edge cases ─────

describe("Retry label — edge cases", () => {
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

  it("returns unknown for empty retry object", () => {
    assert.equal(resolveRetryLabelFromSettings({ retry: {} }), "unknown");
  });

  it("returns unknown for retry.enabled=true without maxRetries", () => {
    assert.equal(resolveRetryLabelFromSettings({ retry: { enabled: true } }), "unknown");
  });

  it("returns unknown for retry.maxRetries without enabled", () => {
    assert.equal(resolveRetryLabelFromSettings({ retry: { maxRetries: 3 } }), "unknown");
  });

  it("returns unknown for malformed retry (string)", () => {
    assert.equal(resolveRetryLabelFromSettings({ retry: "yes" }), "unknown");
  });

  it("returns unknown for non-object settings", () => {
    assert.equal(resolveRetryLabelFromSettings("string"), "unknown");
    assert.equal(resolveRetryLabelFromSettings(42), "unknown");
    assert.equal(resolveRetryLabelFromSettings(undefined), "unknown");
  });
});
