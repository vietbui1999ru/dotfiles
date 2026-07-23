/**
 * Provider governance policy module.
 *
 * Handles authorization-provenance validation, built-in ID collision detection,
 * ACP isolation and circuit-breaker config validation, registration gate checks,
 * and retry/billing status resolution.
 *
 * All functions are pure (no side effects) for testability.
 */

import type {
  AuthorizationProvenance,
  AuthorizationStatus,
  AuthorizationValidation,
  AcpLimits,
  AcpDelegateConfig,
  ProviderGovernanceConfig,
  ConfigValidationResult,
  ConfigValidationError,
  RetryLabel,
} from "./types.ts";
import { BUILT_IN_PROVIDER_IDS, ACP_LIMITS_DEFAULTS } from "./types.ts";

// ───── Authorization Provenance Validation (SPEC §6.2) ─────

/**
 * Validate an authorization-provenance record for a remote endpoint.
 *
 * Rules (SPEC §6.2):
 * - null/undefined → unverifiable
 * - expired → expired
 * - self-hosted-local + no upstream verification → self-declared-only
 * - non-self-hosted + no upstream verification → opaque-relay (rejected)
 * - vendor-public-doc bypasses the opaque-relay check (trusted source)
 * - missing TLS identity → unverifiable
 * - all checks pass → valid
 */
export function validateAuthorization(record: AuthorizationProvenance | null): AuthorizationValidation {
  if (!record) {
    return { status: "unverifiable", reason: "no authorization record provided", daysUntilExpiry: 0, daysUntilReview: 0 };
  }

  const now = Date.now();

  // Expired authorization
  const expiresMs = new Date(record.expiresAt).getTime();
  if (isNaN(expiresMs)) {
    return { status: "unverifiable", reason: "invalid expiry date", daysUntilExpiry: 0, daysUntilReview: 0 };
  }
  const daysUntilExpiry = Math.round((expiresMs - now) / 86400000);

  const reviewMs = new Date(record.reviewAt).getTime();
  const daysUntilReview = isNaN(reviewMs) ? daysUntilExpiry : Math.round((reviewMs - now) / 86400000);

  if (expiresMs < now) {
    return { status: "expired", reason: `authorization expired at ${record.expiresAt} (${-daysUntilExpiry} days ago)`, daysUntilExpiry, daysUntilReview };
  }

  // Self-declared-local evidence without independent upstream verification
  if (record.evidenceType === "self-hosted-local" && record.upstreamVerification === "none") {
    return { status: "self-declared-only", reason: "self-declared endpoint without independent upstream verification", daysUntilExpiry, daysUntilReview };
  }

  // Opaque relay: upstream cannot be independently verified for non-self-hosted
  // endpoints (SPEC §4.3, §6.2). Vendor-public-doc is a trusted evidence type
  // and bypasses this check.
  if (record.upstreamVerification === "none" && record.evidenceType !== "vendor-public-doc") {
    return { status: "opaque-relay", reason: "upstream identity not independently verifiable; opaque relay rejected", daysUntilExpiry, daysUntilReview };
  }

  // Missing TLS identity
  if (!record.endpointTlsIdentity || record.endpointTlsIdentity.trim() === "") {
    return { status: "unverifiable", reason: "endpoint TLS identity is required for remote endpoint authorization", daysUntilExpiry, daysUntilReview };
  }

  return { status: "valid", reason: "authorization verified", daysUntilExpiry, daysUntilReview };
}

// ───── Built-in Provider ID Collision Detection ─────

/** Check if a provider ID collides with a well-known built-in Pi provider. */
export function isBuiltInProviderId(id: string): boolean {
  return BUILT_IN_PROVIDER_IDS.includes(id);
}

/**
 * Reject a custom provider ID if it collides with a built-in provider.
 * Returns `{ allowed: true }` or `{ allowed: false, reason }`.
 */
export function rejectCollision(customId: string): { allowed: boolean; reason?: string } {
  if (isBuiltInProviderId(customId)) {
    return { allowed: false, reason: `'${customId}' is a built-in provider ID and cannot be used by a custom provider` };
  }
  return { allowed: true };
}

// ───── ACP Circuit-Breaker Limit Validation ─────

/** Validate a single ACP circuit-breaker limit value. */
export function validateAcpLimit(value: number, key: string): { valid: boolean; message?: string } {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { valid: false, message: `${key} must be a finite number, got ${typeof value}` };
  }
  if (key === "maxSubprocessRestarts") {
    if (value !== 0) return { valid: false, message: `${key} must be 0 (no auto-restarts), got ${value}` };
    return { valid: true };
  }
  if (value <= 0) return { valid: false, message: `${key} must be > 0, got ${value}` };
  return { valid: true };
}

/** Validate all circuit-breaker limits in an AcpLimits object. */
export function validateAllLimits(limits: AcpLimits): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  for (const [key, value] of Object.entries(limits)) {
    const result = validateAcpLimit(value as number, key);
    if (!result.valid) errors.push(result.message!);
  }
  return { valid: errors.length === 0, errors };
}

// ───── ACP Isolation Defaults Validation ─────

/** Validate ACP isolation config (SPEC §6.11). */
export function validateAcpIsolation(config: AcpDelegateConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Empty by default
  if (!Array.isArray(config.settingSources)) errors.push("settingSources must be an array");
  if (!Array.isArray(config.mcpServers)) errors.push("mcpServers must be an array");
  if (!Array.isArray(config.additionalDirectories)) errors.push("additionalDirectories must be an array");
  if (!Array.isArray(config.defaultTools)) errors.push("defaultTools must be an array");

  // systemPromptMode must be "append"
  if (config.systemPromptMode !== "append") {
    errors.push(`systemPromptMode must be "append", got "${config.systemPromptMode}"`);
  }

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

// ───── Full Config Validation ─────

/** Validate the full provider governance config. */
export function validateConfig(config: ProviderGovernanceConfig): ConfigValidationResult {
  const errors: ConfigValidationError[] = [];
  const warnings: ConfigValidationWarning[] = [];

  // Registration must be disabled in v1
  if (config.registrationEnabled !== false) {
    errors.push({ field: "registrationEnabled", message: "must be false in v1 — live registration blocked pending retry control and authorization gates" });
  }

  // Cross-provider fallback must be disabled
  if (config.allowAutomaticCrossProviderFallback !== false) {
    errors.push({ field: "allowAutomaticCrossProviderFallback", message: "must be false — cross-provider fallback is prohibited" });
  }

  // Config scope must be global-only
  if (config.configScope !== "global-only") {
    errors.push({ field: "configScope", message: `must be "global-only" in v1, got "${config.configScope}"` });
  }

  // Validate ACP delegate config if present
  if (config.acpDelegate) {
    const isolationResult = validateAcpIsolation(config.acpDelegate);
    if (config.acpDelegate.routeEnabled !== false) {
      errors.push({ field: "acpDelegate.routeEnabled", message: "must be false in v1 — ACP delegate requires Phase 2 conformance and Phase 5 sink" });
    }
    if (!isolationResult.valid) {
      for (const err of isolationResult.errors) {
        errors.push({ field: `acpDelegate.${err.split(" ")[0]}`, message: err });
      }
    }
    const limitsResult = validateAllLimits(config.acpDelegate.limits);
    if (!limitsResult.valid) {
      for (const err of limitsResult.errors) {
        errors.push({ field: `acpDelegate.limits`, message: err });
      }
    }
  }

  // Telemetry configuration
  if (config.telemetry) {
    if (config.telemetry.sink !== "bounded-spool" && config.telemetry.sink !== "agentops-cli") {
      warnings.push({ field: "telemetry.sink", message: `unknown sink "${config.telemetry.sink}"` });
    }
    if (typeof config.telemetry.spoolRetentionDays !== "number" || config.telemetry.spoolRetentionDays < 1) {
      warnings.push({ field: "telemetry.spoolRetentionDays", message: "must be >= 1" });
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/** Config validation warning (local type, not in types.ts to avoid circular deps). */
interface ConfigValidationWarning {
  field: string;
  message: string;
}

// ───── Registration Gate Check ─────

/**
 * Check whether a custom provider can be registered given the current config.
 *
 * Gates (SPEC §6.2, PLAN §3):
 * - registrationEnabled must be true
 * - configScope must be "global-only"
 * - project must be trusted
 */
export function checkRegistrationGate(
  config: { registrationEnabled: boolean; configScope: string },
  isTrustedProject: boolean,
): { allowed: boolean; reason?: string } {
  if (!config.registrationEnabled) {
    return { allowed: false, reason: "registrationEnabled is false in config — live registration is disabled" };
  }
  if (config.configScope !== "global-only") {
    return { allowed: false, reason: `only global-only config scope is supported in v1, got "${config.configScope}"` };
  }
  if (!isTrustedProject) {
    return { allowed: false, reason: "project-local provider config is not trusted" };
  }
  return { allowed: true };
}

// ───── Retry Label Resolution ─────

/**
 * Resolve the retry label from parsed settings.
 *
 * Reports `configured | unknown` — does NOT claim to observe actually
 * executed retries (Pi 0.80.x extension API limitation, SPEC §6.1, §6.5).
 */
export function resolveRetryLabel(settings: unknown): RetryLabel {
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
