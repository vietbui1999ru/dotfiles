/**
 * Phase 2 fixture matrix.
 *
 * Each fixture has an expected transport-level terminal classification based on
 * the normative table in the AgentOps provider SPEC §6.5.
 */

import type { MockScenario } from "./mock-anthropic-server.ts";

export interface Phase2Fixture {
  name: string;
  scenario: MockScenario;
  expected: "completed" | "failed" | "outcome-unknown";
  description: string;
}

export const PHASE_2_FIXTURES: readonly Phase2Fixture[] = [
  { name: "text", scenario: "text-simple", expected: "completed", description: "normal text stream" },
  { name: "multiline", scenario: "text-multiline", expected: "completed", description: "multiline text" },
  { name: "thinking", scenario: "thinking", expected: "completed", description: "thinking and text blocks" },
  { name: "thinking-signature", scenario: "thinking-signature", expected: "completed", description: "thinking signature" },
  { name: "tools", scenario: "tool-calls", expected: "completed", description: "single tool call stream" },
  { name: "multiple-tools", scenario: "multiple-tool-calls", expected: "completed", description: "multiple tool calls" },
  { name: "unicode", scenario: "unicode", expected: "completed", description: "Unicode and emoji" },
  { name: "images", scenario: "images", expected: "completed", description: "image input capture" },
  { name: "usage-early", scenario: "usage-early", expected: "completed", description: "usage at message start" },
  { name: "usage-late", scenario: "usage-late", expected: "completed", description: "usage at message delta" },
  { name: "usage-absent", scenario: "usage-absent", expected: "completed", description: "missing usage" },
  { name: "usage-inconsistent", scenario: "usage-inconsistent", expected: "completed", description: "inconsistent usage" },
  { name: "overflow", scenario: "overflow", expected: "completed", description: "large response" },
  { name: "oversized", scenario: "oversized", expected: "completed", description: "oversized response fixture" },
  { name: "abort", scenario: "abort", expected: "outcome-unknown", description: "disconnect after acceptance may have occurred" },
  { name: "401", scenario: "401", expected: "failed", description: "authentication rejection" },
  { name: "403", scenario: "403", expected: "failed", description: "permission rejection" },
  { name: "404", scenario: "404", expected: "failed", description: "model/resource missing" },
  { name: "429", scenario: "429", expected: "failed", description: "rate limit; retryable but terminal for this request" },
  { name: "500", scenario: "500", expected: "failed", description: "server error" },
  { name: "malformed-json", scenario: "malformed-json", expected: "failed", description: "invalid JSON response" },
  { name: "malformed-sse", scenario: "malformed-sse", expected: "failed", description: "invalid SSE event" },
  { name: "disconnect-before-headers", scenario: "disconnect-before-headers", expected: "failed", description: "transport dies before response" },
  { name: "disconnect-mid-stream", scenario: "disconnect-mid-stream", expected: "outcome-unknown", description: "transport dies after content" },
  { name: "slow-headers", scenario: "slow-headers", expected: "completed", description: "slow but successful headers" },
  { name: "slow-stream", scenario: "slow-stream", expected: "completed", description: "slow but complete stream" },
  { name: "model-removed", scenario: "model-removed", expected: "completed", description: "empty discovery result, no inference" },
];
