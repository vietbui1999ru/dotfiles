/** Pure observation helpers for Phase 3 provider governance. */

import type {
  AssistantMessage,
  Api,
  Model,
} from "@earendil-works/pi-ai";
import type {
  AssistantTerminalObservation,
  BillingLabel,
  ProviderClass,
  ProviderHealthState,
  ProviderInventoryEntry,
  ProviderObservationPolicy,
  RequestTerminalState,
  RetryLabel,
} from "./types.ts";

const ANTHROPIC_WARNING =
  "Pi warnings.anthropicExtraUsage remains active; extra usage charges are possible.";

/** Explicit metadata for providers whose class is known independently of model IDs. */
const KNOWN_POLICIES: Record<string, ProviderObservationPolicy> = {
  anthropic: {
    providerClass: "native-subscription",
    authorization: "unverified",
    billing: "vendor-controlled/unverified",
    warnings: [ANTHROPIC_WARNING],
  },
  "openai-codex": {
    providerClass: "native-subscription",
    authorization: "unverified",
    billing: "vendor-controlled/unverified",
  },
  "github-copilot": {
    providerClass: "native-subscription",
    authorization: "unverified",
    billing: "vendor-controlled/unverified",
  },
  ollama: {
    providerClass: "local",
    authorization: "verified",
    billing: "local/no-token-price",
  },
  vllm: {
    providerClass: "local",
    authorization: "verified",
    billing: "local/no-token-price",
  },
  "lm-studio": {
    providerClass: "local",
    authorization: "verified",
    billing: "local/no-token-price",
  },
  "amazon-bedrock": {
    providerClass: "native-api-cloud",
    authorization: "unverified",
    billing: "metered/contract",
  },
  google: {
    providerClass: "native-api-cloud",
    authorization: "unverified",
    billing: "metered/contract",
  },
  "google-vertex": {
    providerClass: "native-api-cloud",
    authorization: "unverified",
    billing: "metered/contract",
  },
  openai: {
    providerClass: "native-api-cloud",
    authorization: "unverified",
    billing: "metered/contract",
  },
};

function unknownPolicy(): ProviderObservationPolicy {
  return {
    providerClass: "unknown",
    authorization: "unverified",
    billing: "unknown",
    warnings: ["Provider class, authorization, and billing are unknown; no inference was made."],
  };
}

/** Resolve only explicit provider metadata; unknown providers stay unknown. */
export function getProviderPolicy(
  providerId: string,
  overrides: Readonly<Record<string, ProviderObservationPolicy>> = {},
): ProviderObservationPolicy {
  const override = overrides[providerId];
  if (override) return clonePolicy(override);
  const known = KNOWN_POLICIES[providerId];
  return known ? clonePolicy(known) : unknownPolicy();
}

function clonePolicy(policy: ProviderObservationPolicy): ProviderObservationPolicy {
  return {
    providerClass: policy.providerClass,
    authorization: policy.authorization,
    billing: policy.billing,
    ...(policy.warnings ? { warnings: [...policy.warnings] } : {}),
  };
}

export interface HealthObservationInput {
  state: ProviderHealthState;
  observedAt?: string;
  httpStatus?: number;
}

/** Convert an already-received response into a bounded health observation. */
export function observeProviderResponse(
  status: number,
  observedAt = new Date().toISOString(),
): HealthObservationInput {
  let state: ProviderHealthState;
  if (status >= 200 && status < 400) {
    state = "healthy";
  } else if (status === 401 || status === 403 || status === 404 || status === 410) {
    state = "unavailable";
  } else if (status === 429 || status >= 500) {
    state = "degraded";
  } else {
    state = "unavailable";
  }
  const httpStatus = Number.isFinite(status) ? status : undefined;
  return { state, observedAt, httpStatus };
}

/** Inventory models from Pi's existing registry without registering or changing anything. */
export function inventoryModels(
  models: readonly Model<Api>[],
  retryLabel: RetryLabel,
  health: Readonly<Record<string, HealthObservationInput>> = {},
  policyOverrides: Readonly<Record<string, ProviderObservationPolicy>> = {},
): ProviderInventoryEntry[] {
  const byProvider = new Map<string, string[]>();
  for (const model of models) {
    const ids = byProvider.get(model.provider) ?? [];
    if (!ids.includes(model.id)) ids.push(model.id);
    byProvider.set(model.provider, ids);
  }

  return [...byProvider.entries()].map(([providerId, modelIds]) => {
    const policy = getProviderPolicy(providerId, policyOverrides);
    const healthObservation = health[providerId] ?? { state: "unknown" as const };
    return {
      providerId,
      modelIds: [...modelIds],
      modelCount: modelIds.length,
      ...policy,
      retryLabel: policy.providerClass === "acp-delegate" ? "automatic retry unknown" : retryLabel,
      health: { ...healthObservation },
    };
  });
}

function finiteUsage(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function classifyStopReason(stopReason: string, hasError: boolean): RequestTerminalState {
  if (hasError || stopReason === "error") return "failed";
  if (stopReason === "aborted") return "cancelled";
  if (stopReason === "length") return "completed-truncated";
  if (stopReason === "stop" || stopReason === "toolUse") return "completed";
  return "outcome-unknown";
}

/** Observe only assistant metadata; content, headers, and error text are discarded. */
interface AssistantObservationInput {
  role?: unknown;
  provider?: unknown;
  model?: unknown;
  stopReason?: unknown;
  content?: unknown;
  usage?: {
    input?: unknown;
    output?: unknown;
    cacheRead?: unknown;
    cacheWrite?: unknown;
  };
  errorMessage?: unknown;
}

export function observeAssistantMessage(
  message: AssistantObservationInput,
  observedAt = new Date().toISOString(),
): AssistantTerminalObservation | undefined {
  if (message.role !== "assistant") return undefined;
  const stopReason = typeof message.stopReason === "string" ? message.stopReason : "unknown";
  const hasError = typeof message.errorMessage === "string" && message.errorMessage.length > 0;
  return {
    providerId: typeof message.provider === "string" ? message.provider : "unknown",
    modelId: typeof message.model === "string" ? message.model : "unknown",
    stopReason,
    status: classifyStopReason(stopReason, hasError),
    usage: {
      input: finiteUsage(message.usage?.input),
      output: finiteUsage(message.usage?.output),
      cacheRead: finiteUsage(message.usage?.cacheRead),
      cacheWrite: finiteUsage(message.usage?.cacheWrite),
    },
    observedAt,
    hasError,
  };
}

export function formatProviderStatus(
  entries: readonly ProviderInventoryEntry[],
  selectedModel?: string,
  terminal?: AssistantTerminalObservation,
): string {
  const lines = ["Provider Governance Status"];
  if (selectedModel) lines.push(`Selected model: ${selectedModel}`);
  lines.push("Inventory (read-only):");
  if (entries.length === 0) lines.push("  (no models registered)");
  for (const entry of entries) {
    const health = entry.health.observedAt
      ? `${entry.health.state} @ ${entry.health.observedAt}`
      : entry.health.state;
    lines.push(
      `  ${entry.providerId}: ${entry.modelCount} model(s); class=${entry.providerClass}; authorization=${entry.authorization}; billing=${entry.billing}; retry=${entry.retryLabel}; health=${health}`,
    );
    for (const warning of entry.warnings ?? []) lines.push(`    Warning: ${warning}`);
    lines.push(`    Models: ${entry.modelIds.join(", ")}`);
  }
  if (terminal) {
    lines.push(
      `Last assistant terminal: ${terminal.providerId}/${terminal.modelId}; status=${terminal.status}; stop=${terminal.stopReason}; usage=${terminal.usage.input}/${terminal.usage.output}`,
    );
  }
  lines.push("No credentials, account identity, tool inputs, headers, or response bodies are displayed.");
  return lines.join("\n");
}

export function anthropicExtraUsageWarning(providerId: string): string | undefined {
  return providerId === "anthropic" ? ANTHROPIC_WARNING : undefined;
}

export function isAssistantMessage(message: unknown): message is AssistantMessage {
  return typeof message === "object" && message !== null && (message as { role?: unknown }).role === "assistant";
}
