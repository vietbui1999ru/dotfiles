/**
 * Provider governance type definitions.
 *
 * Phase 1: adds authorization-provenance types, config validation result,
 * and built-in provider ID registry.
 */

// ───── Phase 0 types (unchanged) ─────

/** Provider class (not inferred from model ID). */
export type ProviderClass =
  | "native-subscription"
  | "native-api-cloud"
  | "local"
  | "acp-delegate"
  | "authorized-custom";

/** Billing label for display. */
export type BillingLabel =
  | "vendor-controlled/unverified"
  | "metered/contract"
  | "local/no-token-price"
  | "subscription/metered-upstream"
  | "configured/unknown";

/** Effective retry label as reported by the extension. */
export type RetryLabel =
  | "configured"
  | "unknown"
  | "automatic retry unknown";

/** Provider authorization state. */
export type AuthorizationState =
  | "unverified"
  | "verified"
  | "expired"
  | "self-declared-only";

/** Request terminal state (normative classification per SPEC §6.5). */
export type RequestTerminalState =
  | "completed"
  | "completed-truncated"
  | "failed"
  | "failed-limit-reached"
  | "cancelled"
  | "outcome-unknown";

/** Tracked provider model. */
export interface ProviderModel {
  id: string;
  providerId: string;
  class: ProviderClass;
  billing: BillingLabel;
  authorization: AuthorizationState;
  retryLabel: RetryLabel;
}

/** Policy record for a provider. */
export interface ProviderPolicy {
  providerId: string;
  providerClass: ProviderClass;
  allowOverage: boolean;
  overageObservable: boolean;
}

/** Health observation at a point in time. */
export interface HealthObservation {
  providerId: string;
  healthy: boolean;
  observedAt: string;
  error?: string;
}

/** Event envelope for telemetry (sanitized, no prompt/credential content). */
export interface SanitizedProviderEvent {
  schemaVersion: 1;
  eventId: string;
  eventType: string;
  occurredAt: string;
  providerId: string;
  providerClass: ProviderClass;
  modelId: string;
  sessionId: string;
  status: RequestTerminalState | "pending" | "streaming" | "dispatched";
  latencyMs?: number;
  usage?: ProviderUsage;
  redaction: { rulesVersion: 1; redacted: boolean };
}

export interface ProviderUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number | null;
  billingClass: string;
}

/** Global extension config shape. */
export interface ProviderGovernanceConfig {
  governanceEnabled: boolean;
  registrationEnabled: boolean;
  configScope: "global-only";
  allowAutomaticCrossProviderFallback: false;
  acpDelegate?: AcpDelegateConfig;
  telemetry?: TelemetryConfig;
}

export interface AcpDelegateConfig {
  routeEnabled: false;
  settingSources: [];
  mcpServers: [];
  additionalDirectories: [];
  defaultTools: [];
  allowedToolsByWorkType: Record<string, string[]>;
  disallowedTools: string[];
  systemPromptMode: "append";
  permissionTimeoutMs: number;
  allowAlways: false;
  inheritProcessEnv: false;
  environmentAllowlist: string[];
  limits: AcpLimits;
}

export interface AcpLimits {
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

export interface TelemetryConfig {
  sink: "agentops-cli" | "bounded-spool";
  spoolRetentionDays: 30;
}

// ───── Phase 1 additions ─────

/**
 * Authorization-provenance record for remote endpoint registration (SPEC §6.2).
 *
 * Every field is required. Unknown/expired/self-declared-only records fail closed.
 * Opaque relays whose upstream cannot be independently verified are rejected.
 */
export interface AuthorizationProvenance {
  authorizationId: string;
  providerOwner: string;
  endpointOrigin: string;
  /** Verified TLS certificate subject/SAN — binds the record to an endpoint identity. */
  endpointTlsIdentity: string;
  /** Declared upstream service (e.g. "anthropic", "google", "self-hosted"). */
  upstreamService: string;
  /** How upstream identity was independently verified — "none" means rejected. */
  upstreamVerification: "none" | "tls-certificate" | "vendor-documentation" | "on-site-audit";
  approvedAuthMechanism: string;
  evidenceType: "vendor-public-doc" | "written-vendor-approval" | "self-hosted-local";
  evidenceReference: string;
  approvedAt: string;   // ISO 8601
  expiresAt: string;    // ISO 8601
  reviewAt: string;     // ISO 8601 — next review date
  approvedBy: string;
}

/** Resolved authorization status for a remote endpoint. */
export type AuthorizationStatus =
  | "valid"
  | "expired"
  | "unverifiable"
  | "self-declared-only"
  | "opaque-relay"; // upstream not independently verified

/** Result of validating an authorization-provenance record. */
export interface AuthorizationValidation {
  status: AuthorizationStatus;
  reason: string;
  /** Days until expiry/review (negative if past). */
  daysUntilExpiry: number;
  daysUntilReview: number;
}

/** Result of validating the full config. */
export interface ConfigValidationResult {
  valid: boolean;
  errors: ConfigValidationError[];
  warnings: ConfigValidationWarning[];
}

export interface ConfigValidationError {
  field: string;
  message: string;
}

export interface ConfigValidationWarning {
  field: string;
  message: string;
}

/**
 * Well-known built-in provider IDs that custom providers must not collide with.
 * Per SPEC §6.2: "custom IDs colliding with built-in provider IDs are rejected."
 */
export const BUILT_IN_PROVIDER_IDS: readonly string[] = [
  "anthropic",
  "openai",
  "google",
  "bedrock",
  "openai-codex",
  "gpt-5",
  "copilot",
  "opencode-go",
  "deepseek",
  "gemini",
];

/**
 * Default circuit-breaker limits (SPEC §6.11).
 * All values are finite. maxSubprocessRestarts must be 0.
 */
export const ACP_LIMITS_DEFAULTS: AcpLimits = {
  wallClockDeadlineMs: 900000,       // 15 minutes
  maxPromptTurns: 8,
  maxToolCalls: 40,
  maxRepeatedAction: 3,
  maxRepeatedError: 3,
  maxPermissionDenials: 2,
  maxPolicyViolations: 1,
  maxOutputBytes: 10485760,          // 10 MiB
  maxSubprocessRestarts: 0,
};

/** ACP isolation defaults (SPEC §6.11). */
export const ACP_ISOLATION_DEFAULTS = {
  settingSources: [] as string[],
  mcpServers: [] as string[],
  additionalDirectories: [] as string[],
  defaultTools: [] as string[],
  disallowedTools: ["Bash", "WebFetch", "WebSearch", "AskUserQuestion"],
  systemPromptMode: "append" as const,
  permissionTimeoutMs: 30000,
  allowAlways: false,
  inheritProcessEnv: false,
  environmentAllowlist: ["HOME", "PATH", "TMPDIR", "TERM"],
};

/**
 * Repository defaults (disabled-by-default) — never written to user config.
 * Used as a reference for `shared/agent-workflow.default.json`.
 */
export const REPOSITORY_DEFAULTS = {
  governanceEnabled: true,
  registrationEnabled: false,
  configScope: "global-only",
  allowAutomaticCrossProviderFallback: false,
  acpDelegate: {
    routeEnabled: false,
    ...ACP_ISOLATION_DEFAULTS,
    allowedToolsByWorkType: {} as Record<string, string[]>,
    limits: { ...ACP_LIMITS_DEFAULTS },
  },
  telemetry: {
    sink: "bounded-spool" as const,
    spoolRetentionDays: 30,
  },
};
