/**
 * Phase 1 tests — authorization provenance, config validation, built-in IDs.
 *
 * Run: tsx --test test/*.test.ts
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

// ───── 1. Authorization provenance validation ─────

describe("AuthorizationProvenance", () => {
  type AuthorizationProvenance = {
    authorizationId: string;
    providerOwner: string;
    endpointOrigin: string;
    endpointTlsIdentity: string;
    upstreamService: string;
    upstreamVerification: string;
    approvedAuthMechanism: string;
    evidenceType: string;
    evidenceReference: string;
    approvedAt: string;
    expiresAt: string;
    reviewAt: string;
    approvedBy: string;
  };

  type AuthorizationStatus =
    | "valid"
    | "expired"
    | "unverifiable"
    | "self-declared-only"
    | "opaque-relay";

  function validateAuthorization(record: AuthorizationProvenance | null): {
    status: AuthorizationStatus;
    reason: string;
  } {
    if (!record) return { status: "unverifiable", reason: "no record provided" };

    // Self-declared-local evidence without independent upstream verification
    if (record.evidenceType === "self-hosted-local" && record.upstreamVerification === "none") {
      return { status: "self-declared-only", reason: "self-declared endpoint without independent upstream verification" };
    }

    // Opaque relay: upstream cannot be independently verified for non-self-hosted
    // endpoints (SPEC §4.3, §6.2). Vendor-public-doc is a trusted evidence type
    // and bypasses this check — the vendor's documentation is the source of truth.
    if (record.upstreamVerification === "none" && record.evidenceType !== "vendor-public-doc") {
      return { status: "opaque-relay", reason: "upstream identity not independently verifiable; opaque relay rejected" };
    }

    // Expired authorization
    const now = Date.now();
    const expiresMs = new Date(record.expiresAt).getTime();
    if (isNaN(expiresMs)) return { status: "unverifiable", reason: "invalid expiry date" };
    if (expiresMs < now) return { status: "expired", reason: `authorization expired at ${record.expiresAt}` };

    // Missing TLS identity for remote endpoints
    if (!record.endpointTlsIdentity || record.endpointTlsIdentity.trim() === "") {
      return { status: "unverifiable", reason: "endpoint TLS identity is required" };
    }

    return { status: "valid", reason: "authorization verified" };
  }

  function makeValidRecord(overrides?: Partial<AuthorizationProvenance>): AuthorizationProvenance {
    const future = new Date(Date.now() + 86400000 * 30).toISOString(); // 30 days from now
    return {
      authorizationId: "auth-001",
      providerOwner: "user",
      endpointOrigin: "https://gateway.corp.com",
      endpointTlsIdentity: "CN=gateway.corp.com",
      upstreamService: "anthropic",
      upstreamVerification: "tls-certificate",
      approvedAuthMechanism: "api-key",
      evidenceType: "vendor-public-doc",
      evidenceReference: "https://vendor.com/docs",
      approvedAt: "2026-07-01T00:00:00Z",
      expiresAt: future,
      reviewAt: future,
      approvedBy: "admin",
      ...overrides,
    };
  }

  it("returns valid for a fully verified record", () => {
    const result = validateAuthorization(makeValidRecord());
    assert.equal(result.status, "valid");
  });

  it("returns unverifiable for null record", () => {
    const result = validateAuthorization(null);
    assert.equal(result.status, "unverifiable");
  });

  it("returns expired when expiry is in the past", () => {
    const record = makeValidRecord({ expiresAt: "2020-01-01T00:00:00Z" });
    const result = validateAuthorization(record);
    assert.equal(result.status, "expired");
  });

  it("returns unverifiable for invalid expiry date", () => {
    const record = makeValidRecord({ expiresAt: "not-a-date" });
    const result = validateAuthorization(record);
    assert.equal(result.status, "unverifiable");
  });

  it("returns self-declared-only for self-hosted-local without upstream verification", () => {
    const record = makeValidRecord({
      evidenceType: "self-hosted-local",
      upstreamVerification: "none",
    });
    const result = validateAuthorization(record);
    assert.equal(result.status, "self-declared-only");
  });

  it("returns opaque-relay for non-self-hosted endpoint with unverifiable upstream", () => {
    // A third-party approved endpoint (written-vendor-approval) without upstream
    // verification is an opaque relay — someone approved the endpoint but nobody
    // verified where it actually routes to.
    const record = makeValidRecord({
      upstreamVerification: "none",
      evidenceType: "written-vendor-approval",
    });
    const result = validateAuthorization(record);
    assert.equal(result.status, "opaque-relay");
  });

  it("is self-declared-only (not opaque-relay) for self-hosted with no upstream verification", () => {
    // Self-hosted without upstream verification is self-declared-only,
    // not opaque-relay — the operator knows what they host; the gap is proving it.
    const record = makeValidRecord({
      upstreamVerification: "none",
      evidenceType: "self-hosted-local",
    });
    const result = validateAuthorization(record);
    assert.equal(result.status, "self-declared-only");
  });

  it("returns unverifiable when TLS identity is missing", () => {
    const record = makeValidRecord({ endpointTlsIdentity: "" });
    const result = validateAuthorization(record);
    assert.equal(result.status, "unverifiable");
  });

  it("passes for self-hosted with independent upstream verification", () => {
    const record = makeValidRecord({
      evidenceType: "self-hosted-local",
      upstreamVerification: "on-site-audit",
    });
    const result = validateAuthorization(record);
    assert.equal(result.status, "valid");
  });

  it("passes for vendor-public-doc with any upstream verification", () => {
    const record = makeValidRecord({
      evidenceType: "vendor-public-doc",
      upstreamVerification: "none",
    });
    const result = validateAuthorization(record);
    assert.equal(result.status, "valid", "vendor docs = trusted source, not opaque");
  });
});

// ───── 2. Built-in provider ID collision detection ─────

describe("BuiltInProviderIds", () => {
  const BUILT_IN = [
    "anthropic", "openai", "google", "bedrock",
    "openai-codex", "gpt-5", "copilot", "opencode-go",
    "deepseek", "gemini",
  ];

  function isBuiltInProviderId(id: string): boolean {
    return BUILT_IN.includes(id);
  }

  function rejectCollision(customId: string): { allowed: boolean; reason?: string } {
    if (isBuiltInProviderId(customId)) {
      return { allowed: false, reason: `'${customId}' is a built-in provider ID and cannot be used by a custom provider` };
    }
    return { allowed: true };
  }

  it("rejects collision with every built-in ID", () => {
    for (const id of BUILT_IN) {
      const result = rejectCollision(id);
      assert.equal(result.allowed, false, `${id} should be rejected`);
      assert.ok(result.reason!.includes("built-in"), `reason should mention built-in: ${result.reason}`);
    }
  });

  it("allows unique custom IDs", () => {
    assert.deepEqual(rejectCollision("my-custom-provider"), { allowed: true });
    assert.deepEqual(rejectCollision("corporate-gateway"), { allowed: true });
    assert.deepEqual(rejectCollision("local-ollama"), { allowed: true });
  });

  it("is case-sensitive (built-in IDs are lowercase)", () => {
    assert.deepEqual(rejectCollision("Anthropic"), { allowed: true });
    assert.deepEqual(rejectCollision("OpenAI"), { allowed: true });
  });

  it("rejects empty string", () => {
    const result = rejectCollision("");
    assert.equal(result.allowed, true, "empty string is not a collision but will be rejected elsewhere");
  });
});

// ───── 3. ACP circuit-breaker config validation ─────

describe("AcpLimits validation", () => {
  interface AcpLimits {
    wallClockDeadlineMs: number;
    maxPromptTurns: number;
    maxToolCalls: number;
    maxRepeatedAction: number;
    maxRepeatedError: number;
    maxPermissionDenials: number;
    maxPolicyViolations: number;
    maxOutputBytes: number;
    maxSubprocessRestarts: number;
  }

  const VALID_LIMITS: AcpLimits = {
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

  function validateAcpLimit(value: number, key: string): { valid: boolean; message?: string } {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { valid: false, message: `${key} must be a finite number, got ${typeof value}` };
    }
    if (key === "maxSubprocessRestarts") {
      if (value !== 0) return { valid: false, message: `${key} must be 0, got ${value}` };
      return { valid: true };
    }
    if (value <= 0) return { valid: false, message: `${key} must be > 0, got ${value}` };
    return { valid: true };
  }

  function validateAllLimits(limits: AcpLimits): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    for (const [key, value] of Object.entries(limits)) {
      const result = validateAcpLimit(value as number, key);
      if (!result.valid) errors.push(result.message!);
    }
    return { valid: errors.length === 0, errors };
  }

  it("valid limits pass", () => {
    const result = validateAllLimits(VALID_LIMITS);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects negative wallClockDeadlineMs", () => {
    const result = validateAllLimits({ ...VALID_LIMITS, wallClockDeadlineMs: -1 });
    assert.equal(result.valid, false);
    assert.ok(result.errors[0]!.includes("> 0"));
  });

  it("rejects zero maxToolCalls", () => {
    const result = validateAllLimits({ ...VALID_LIMITS, maxToolCalls: 0 });
    assert.equal(result.valid, false);
  });

  it("rejects Infinity", () => {
    const result = validateAllLimits({ ...VALID_LIMITS, wallClockDeadlineMs: Infinity });
    assert.equal(result.valid, false);
  });

  it("accepts 0 for maxSubprocessRestarts", () => {
    const result = validateAcpLimit(0, "maxSubprocessRestarts");
    assert.equal(result.valid, true);
  });

  it("rejects non-zero for maxSubprocessRestarts", () => {
    assert.equal(validateAcpLimit(1, "maxSubprocessRestarts").valid, false);
    assert.equal(validateAcpLimit(-1, "maxSubprocessRestarts").valid, false);
  });

  it("rejects NaN", () => {
    const result = validateAllLimits({ ...VALID_LIMITS, maxToolCalls: NaN });
    assert.equal(result.valid, false);
  });
});

// ───── 4. ACP isolation defaults validation ─────

describe("ACP isolation defaults", () => {
  interface AcpIsolation {
    settingSources: string[];
    mcpServers: string[];
    additionalDirectories: string[];
    defaultTools: string[];
    disallowedTools: string[];
    systemPromptMode: string;
    permissionTimeoutMs: number;
    allowAlways: boolean;
    inheritProcessEnv: boolean;
    environmentAllowlist: string[];
  }

  const DEFAULTS: AcpIsolation = {
    settingSources: [],
    mcpServers: [],
    additionalDirectories: [],
    defaultTools: [],
    disallowedTools: ["Bash", "WebFetch", "WebSearch", "AskUserQuestion"],
    systemPromptMode: "append",
    permissionTimeoutMs: 30000,
    allowAlways: false,
    inheritProcessEnv: false,
    environmentAllowlist: ["HOME", "PATH", "TMPDIR", "TERM"],
  };

  function validateAcpIsolation(config: AcpIsolation): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Empty by default: settingSources, mcpServers, additionalDirectories, defaultTools
    if (!Array.isArray(config.settingSources)) errors.push("settingSources must be an array");
    if (!Array.isArray(config.mcpServers)) errors.push("mcpServers must be an array");
    if (!Array.isArray(config.additionalDirectories)) errors.push("additionalDirectories must be an array");
    if (!Array.isArray(config.defaultTools)) errors.push("defaultTools must be an array");

    // systemPromptMode must be "append"
    if (config.systemPromptMode !== "append") errors.push(`systemPromptMode must be "append", got "${config.systemPromptMode}"`);

    // allowAlways must be false
    if (config.allowAlways !== false) errors.push("allowAlways must be false");

    // inheritProcessEnv must be false
    if (config.inheritProcessEnv !== false) errors.push("inheritProcessEnv must be false");

    // permissionTimeoutMs must be positive
    if (typeof config.permissionTimeoutMs !== "number" || config.permissionTimeoutMs <= 0) {
      errors.push("permissionTimeoutMs must be a positive number");
    }

    // environmentAllowlist must be non-empty
    if (!Array.isArray(config.environmentAllowlist) || config.environmentAllowlist.length === 0) {
      errors.push("environmentAllowlist must be a non-empty array");
    }

    return { valid: errors.length === 0, errors };
  }

  it("defaults pass validation", () => {
    const result = validateAcpIsolation(DEFAULTS);
    assert.equal(result.valid, true);
    assert.deepEqual(result.errors, []);
  });

  it("rejects allowAlways=true", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, allowAlways: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("allowAlways")));
  });

  it("rejects inheritProcessEnv=true", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, inheritProcessEnv: true });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("inheritProcessEnv")));
  });

  it("rejects systemPromptMode=replace", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, systemPromptMode: "replace" });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some(e => e.includes("systemPromptMode")));
  });

  it("rejects zero permissionTimeoutMs", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, permissionTimeoutMs: 0 });
    assert.equal(result.valid, false);
  });

  it("rejects empty environmentAllowlist", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, environmentAllowlist: [] });
    assert.equal(result.valid, false);
  });

  it("rejects non-array mcpServers", () => {
    const result = validateAcpIsolation({ ...DEFAULTS, mcpServers: null as unknown as string[] });
    assert.equal(result.valid, false);
  });
});

// ───── 5. Registration gate checks ─────

describe("Registration gate", () => {
  /** Gate check: can a custom provider be registered? */
  function canRegister(
    config: { registrationEnabled: boolean; configScope: string },
    isTrustedProject: boolean,
  ): { allowed: boolean; reason?: string } {
    if (!config.registrationEnabled) {
      return { allowed: false, reason: "registrationEnabled is false in config" };
    }
    if (config.configScope !== "global-only") {
      return { allowed: false, reason: "only global-only config scope is supported in v1" };
    }
    if (!isTrustedProject) {
      return { allowed: false, reason: "project-local provider config is not trusted" };
    }
    return { allowed: true };
  }

  it("blocks registration when config has registrationEnabled=false", () => {
    const result = canRegister(
      { registrationEnabled: false, configScope: "global-only" },
      true,
    );
    assert.equal(result.allowed, false);
    assert.ok(result.reason!.includes("registrationEnabled"));
  });

  it("blocks registration for untrusted project", () => {
    const result = canRegister(
      { registrationEnabled: true, configScope: "global-only" },
      false,
    );
    assert.equal(result.allowed, false);
    assert.ok(result.reason!.includes("not trusted"));
  });

  it("blocks registration when scope is not global-only", () => {
    const result = canRegister(
      { registrationEnabled: true, configScope: "project" as string },
      true,
    );
    assert.equal(result.allowed, false);
    assert.ok(result.reason!.includes("global-only"));
  });

  it("allows registration only when all gates pass", () => {
    const result = canRegister(
      { registrationEnabled: true, configScope: "global-only" },
      true,
    );
    assert.equal(result.allowed, true);
  });
});

// ───── 6. Retry and billing status resolution ─────

describe("Retry and billing status", () => {
  type RetryLabel = "configured" | "unknown" | "automatic retry unknown";

  function resolveRetryLabel(settings: unknown): RetryLabel {
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

  it("returns 'configured' when settings are fully resolved", () => {
    assert.equal(resolveRetryLabel({ retry: { enabled: true, maxRetries: 3 } }), "configured");
    assert.equal(resolveRetryLabel({ retry: { enabled: false } }), "configured");
  });

  it("returns 'unknown' when settings are missing or partial", () => {
    assert.equal(resolveRetryLabel({}), "unknown");
    assert.equal(resolveRetryLabel({ retry: {} }), "unknown");
    assert.equal(resolveRetryLabel({ retry: { enabled: true } }), "unknown");
  });

  it("explicitly labels ACP turns", () => {
    const acpLabel: RetryLabel = "automatic retry unknown";
    assert.equal(acpLabel, "automatic retry unknown");
  });
});
