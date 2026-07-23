/** Phase 3 observation-first governance tests. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  anthropicExtraUsageWarning,
  formatProviderStatus,
  getProviderPolicy,
  inventoryModels,
  isAssistantMessage,
  observeAssistantMessage,
  observeProviderResponse,
} from "../src/observation.ts";
import type { RetryLabel } from "../src/types.ts";

const EXTENSION = join(import.meta.dirname, "../src/index.ts");

function model(provider: string, id: string): any {
  return {
    provider,
    id,
    name: id,
    api: "anthropic-messages",
    baseUrl: "http://127.0.0.1:1",
    reasoning: false,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 4096,
  };
}

describe("Phase 3 provider inventory", () => {
  it("inventories the existing registry without changing models or providers", () => {
    const models = [model("anthropic", "claude-sonnet"), model("anthropic", "claude-opus"), model("mystery", "model-1")];
    const before = models.map((item) => ({ provider: item.provider, id: item.id }));
    const entries = inventoryModels(models, "configured");

    assert.deepEqual(models.map((item) => ({ provider: item.provider, id: item.id })), before);
    assert.deepEqual(entries.map((entry) => entry.providerId), ["anthropic", "mystery"]);
    assert.deepEqual(entries[0]?.modelIds, ["claude-sonnet", "claude-opus"]);
    assert.equal(entries[0]?.modelCount, 2);
    assert.equal(entries[1]?.providerClass, "unknown");
    assert.equal(entries[1]?.billing, "unknown");
  });

  it("does not infer a class from an unknown model name", () => {
    const policy = getProviderPolicy("custom-claude-sonnet");
    assert.equal(policy.providerClass, "unknown");
    assert.equal(policy.authorization, "unverified");
    assert.equal(policy.billing, "unknown");
  });

  it("preserves the native Anthropic extra-usage warning", () => {
    const entries = inventoryModels([model("anthropic", "claude-sonnet")], "unknown");
    assert.equal(anthropicExtraUsageWarning("anthropic")?.includes("anthropicExtraUsage"), true);
    assert.equal(entries[0]?.authorization, "unverified");
    assert.equal(entries[0]?.billing, "vendor-controlled/unverified");
    assert.ok(entries[0]?.warnings?.some((warning) => warning.includes("charges")));
  });

  it("uses response hooks only for health and records freshness", () => {
    const at = "2026-07-23T00:00:00.000Z";
    assert.deepEqual(observeProviderResponse(200, at), { state: "healthy", observedAt: at, httpStatus: 200 });
    assert.equal(observeProviderResponse(429, at).state, "degraded");
    assert.equal(observeProviderResponse(401, at).state, "unavailable");
    const entries = inventoryModels(
      [model("anthropic", "claude-sonnet")],
      "configured",
      { anthropic: observeProviderResponse(200, at) },
    );
    assert.deepEqual(entries[0]?.health, { state: "healthy", observedAt: at, httpStatus: 200 });
  });
});

describe("Phase 3 terminal assistant observation", () => {
  it("observes terminal metadata and discards content and error text", () => {
    const secret = "sk-secret-prompt-tool-body";
    const observation = observeAssistantMessage({
      role: "assistant",
      provider: "anthropic",
      model: "claude-sonnet",
      stopReason: "stop",
      errorMessage: secret,
      usage: { input: 12, output: 7, cacheRead: 2, cacheWrite: 1 },
      content: [{ type: "text", text: secret }],
    }, "2026-07-23T00:00:00.000Z");
    assert.equal(observation?.status, "failed");
    assert.equal(observation?.hasError, true);
    assert.deepEqual(observation?.usage, { input: 12, output: 7, cacheRead: 2, cacheWrite: 1 });
    assert.equal(JSON.stringify(observation).includes(secret), false);
  });

  it("classifies length, abort, error, and unknown conservatively", () => {
    assert.equal(observeAssistantMessage({ role: "assistant", stopReason: "length" })?.status, "completed-truncated");
    assert.equal(observeAssistantMessage({ role: "assistant", stopReason: "aborted" })?.status, "cancelled");
    assert.equal(observeAssistantMessage({ role: "assistant", stopReason: "error" })?.status, "failed");
    assert.equal(observeAssistantMessage({ role: "assistant", stopReason: "future-stop" })?.status, "outcome-unknown");
  });

  it("ignores user and tool-result messages", () => {
    assert.equal(observeAssistantMessage({ role: "user", content: "prompt" }), undefined);
    assert.equal(isAssistantMessage({ role: "toolResult" }), false);
    assert.equal(isAssistantMessage({ role: "assistant" }), true);
  });
});

describe("Phase 3 status safety", () => {
  it("renders labels and metadata but never message bodies or credentials", () => {
    const secret = "Bearer super-secret-prompt";
    const entry = inventoryModels([model("anthropic", "claude-sonnet")], "configured")[0]!;
    const terminal = observeAssistantMessage({ role: "assistant", provider: "anthropic", model: "claude-sonnet", stopReason: "stop", errorMessage: secret });
    const rendered = formatProviderStatus([entry], "anthropic/claude-sonnet", terminal);
    assert.match(rendered, /authorization=unverified/);
    assert.match(rendered, /billing=vendor-controlled\/unverified/);
    assert.match(rendered, /retry=configured/);
    assert.equal(rendered.includes(secret), false);
    assert.equal(rendered.includes("prompt"), false);
    assert.equal(rendered.includes("Bearer"), false);
  });

  it("keeps retry labels within the declared observation scope", () => {
    for (const label of ["configured", "unknown"] satisfies RetryLabel[]) {
      const entry = inventoryModels([model("mystery", "model")], label)[0]!;
      assert.ok(["configured", "unknown"].includes(entry.retryLabel));
    }
  });

  it("does not register providers, select models, or use TUI-only overlays", () => {
    const source = readFileSync(EXTENSION, "utf8");
    assert.equal(/\bpi\.registerProvider\s*\(/.test(source), false);
    assert.equal(/\bpi\.setModel\s*\(/.test(source), false);
    assert.equal(source.includes("ctx.ui.custom("), false);
    assert.equal(source.includes("ctx.hasUI"), true);
  });
});
