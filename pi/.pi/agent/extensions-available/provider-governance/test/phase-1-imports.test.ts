/**
 * Phase 1 — import-based tests that validate the real module exports.
 *
 * These tests import from the actual src/ modules rather than redefining
 * pure functions, ensuring the shipped code matches the test contract.
 */

import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

// ───── Policy module exports ─────

describe("policy.ts exports (real module)", () => {
  let policy: typeof import("../src/policy.ts");

  before(async () => {
    policy = await import("../src/policy.ts");
  });

  it("exports validateAuthorization", () => {
    assert.equal(typeof policy.validateAuthorization, "function");
    const result = policy.validateAuthorization(null);
    assert.equal(result.status, "unverifiable");
  });

  it("exports isBuiltInProviderId", () => {
    assert.equal(typeof policy.isBuiltInProviderId, "function");
    assert.equal(policy.isBuiltInProviderId("anthropic"), true);
    assert.equal(policy.isBuiltInProviderId("custom"), false);
  });

  it("exports rejectCollision", () => {
    assert.equal(typeof policy.rejectCollision, "function");
    assert.equal(policy.rejectCollision("anthropic").allowed, false);
    assert.equal(policy.rejectCollision("my-provider").allowed, true);
  });

  it("exports validateAcpLimit", () => {
    assert.equal(typeof policy.validateAcpLimit, "function");
  });

  it("exports validateAllLimits", () => {
    assert.equal(typeof policy.validateAllLimits, "function");
  });

  it("exports validateAcpIsolation", () => {
    assert.equal(typeof policy.validateAcpIsolation, "function");
  });

  it("exports validateConfig", () => {
    assert.equal(typeof policy.validateConfig, "function");
  });

  it("exports checkRegistrationGate", () => {
    assert.equal(typeof policy.checkRegistrationGate, "function");
    // Default config (registrationEnabled=false) should block
    const result = policy.checkRegistrationGate(
      { registrationEnabled: false, configScope: "global-only" },
      true,
    );
    assert.equal(result.allowed, false);
  });

  it("exports resolveRetryLabel", () => {
    assert.equal(typeof policy.resolveRetryLabel, "function");
    assert.equal(policy.resolveRetryLabel({ retry: { enabled: false } }), "configured");
    assert.equal(policy.resolveRetryLabel({}), "unknown");
  });

  it("validateAuthorization correctly classifies all statuses", () => {
    const future = new Date(Date.now() + 86400000 * 30).toISOString();

    // Valid
    const valid = policy.validateAuthorization({
      authorizationId: "auth-1",
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
    });
    assert.equal(valid.status, "valid");

    // Expired
    const expired = policy.validateAuthorization({
      authorizationId: "auth-2",
      providerOwner: "user",
      endpointOrigin: "https://old-gateway.corp.com",
      endpointTlsIdentity: "CN=old-gateway.corp.com",
      upstreamService: "anthropic",
      upstreamVerification: "tls-certificate",
      approvedAuthMechanism: "api-key",
      evidenceType: "vendor-public-doc",
      evidenceReference: "https://vendor.com/docs",
      approvedAt: "2024-01-01T00:00:00Z",
      expiresAt: "2024-06-01T00:00:00Z",
      reviewAt: "2024-06-01T00:00:00Z",
      approvedBy: "admin",
    });
    assert.equal(expired.status, "expired");

    // Self-declared
    const selfDeclared = policy.validateAuthorization({
      authorizationId: "auth-3",
      providerOwner: "user",
      endpointOrigin: "https://my-server.local",
      endpointTlsIdentity: "CN=my-server.local",
      upstreamService: "anthropic",
      upstreamVerification: "none",
      approvedAuthMechanism: "api-key",
      evidenceType: "self-hosted-local",
      evidenceReference: "internal-config",
      approvedAt: "2026-07-01T00:00:00Z",
      expiresAt: future,
      reviewAt: future,
      approvedBy: "self",
    });
    assert.equal(selfDeclared.status, "self-declared-only");

    // Opaque relay
    const opaque = policy.validateAuthorization({
      authorizationId: "auth-4",
      providerOwner: "user",
      endpointOrigin: "https://some-proxy.xyz",
      endpointTlsIdentity: "CN=some-proxy.xyz",
      upstreamService: "anthropic",
      upstreamVerification: "none",
      approvedAuthMechanism: "api-key",
      evidenceType: "written-vendor-approval",
      evidenceReference: "vendor-email",
      approvedAt: "2026-07-01T00:00:00Z",
      expiresAt: future,
      reviewAt: future,
      approvedBy: "vendor",
    });
    assert.equal(opaque.status, "opaque-relay");
  });
});

// ───── Config module exports ─────

describe("config.ts exports (real module)", () => {
  let config: typeof import("../src/config.ts");

  before(async () => {
    config = await import("../src/config.ts");
  });

  it("exports loadConfig", () => {
    assert.equal(typeof config.loadConfig, "function");
    const cfg = config.loadConfig();
    assert.ok(cfg);
    assert.equal(cfg.governanceEnabled, true);
  });

  it("exports loadConfigWithValidation", () => {
    assert.equal(typeof config.loadConfigWithValidation, "function");
    const { config: cfg, validation } = config.loadConfigWithValidation();
    assert.ok(cfg);
    assert.ok(validation);
    assert.ok("valid" in validation);
    assert.ok("errors" in validation);
    assert.ok("warnings" in validation);
  });

  it("exports writeConfig", () => {
    assert.equal(typeof config.writeConfig, "function");
  });

  it("exports configPath", () => {
    assert.equal(typeof config.configPath, "function");
    const p = config.configPath();
    assert.ok(p.includes("provider-governance.json"));
  });

  it("exports DEFAULTS", () => {
    assert.ok(config.DEFAULTS);
    assert.equal(config.DEFAULTS.registrationEnabled, false);
    assert.equal(config.DEFAULTS.configScope, "global-only");
  });

  it("loadConfigWithValidation returns valid config (defaults match spec)", () => {
    const { config: cfg, validation } = config.loadConfigWithValidation();
    // Defaults should always validate clean
    assert.equal(validation.valid, true,
      `default config should be valid: ${JSON.stringify(validation.errors)}`);
  });
});

// ───── Types module exports ─────

describe("types.ts exports (real module)", () => {
  let types: typeof import("../src/types.ts");

  before(async () => {
    types = await import("../src/types.ts");
  });

  it("exports BUILT_IN_PROVIDER_IDS", () => {
    assert.ok(Array.isArray(types.BUILT_IN_PROVIDER_IDS));
    assert.ok(types.BUILT_IN_PROVIDER_IDS.length >= 10);
    assert.ok(types.BUILT_IN_PROVIDER_IDS.includes("anthropic"));
  });

  it("exports ACP_LIMITS_DEFAULTS", () => {
    assert.ok(types.ACP_LIMITS_DEFAULTS);
    assert.equal(types.ACP_LIMITS_DEFAULTS.maxSubprocessRestarts, 0);
    assert.equal(types.ACP_LIMITS_DEFAULTS.wallClockDeadlineMs, 900000);
  });

  it("exports ACP_ISOLATION_DEFAULTS", () => {
    assert.ok(types.ACP_ISOLATION_DEFAULTS);
    assert.equal(types.ACP_ISOLATION_DEFAULTS.allowAlways, false);
    assert.equal(types.ACP_ISOLATION_DEFAULTS.systemPromptMode, "append");
  });

  it("exports REPOSITORY_DEFAULTS", () => {
    assert.ok(types.REPOSITORY_DEFAULTS);
    assert.equal(types.REPOSITORY_DEFAULTS.registrationEnabled, false);
    assert.equal(types.REPOSITORY_DEFAULTS.allowAutomaticCrossProviderFallback, false);
  });
});
