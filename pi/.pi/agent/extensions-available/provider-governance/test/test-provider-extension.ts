/**
 * Test-only Pi extension for Phase 2 mock conformance.
 *
 * This file must never be auto-discovered or installed as a user extension.
 * It registers only the loopback mock provider and never changes Pi's selected model.
 *
 * Usage:
 *   MOCK_ANTHROPIC_BASE_URL=http://127.0.0.1:12345 \
 *   PI_OFFLINE=1 PI_CODING_AGENT_DIR=/tmp/pi-mock \
 *   pi -e ./test/test-provider-extension.ts --list-models
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "mock-anthropic";
const BASE_URL = process.env["MOCK_ANTHROPIC_BASE_URL"] ?? "http://127.0.0.1:0";

// Explicit test-only egress guard. The Phase 2 harness sets this implicitly by
// loading this extension; non-loopback fetches fail before leaving the process.
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
	const rawUrl =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	const parsed = new URL(rawUrl);
	if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") {
		throw new Error(`Phase 2 egress denied: ${parsed.hostname}`);
	}
	return nativeFetch(input, init);
};

export default function (pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER_ID, {
		name: "Phase 2 Mock Anthropic",
		baseUrl: BASE_URL,
		apiKey: "mock-phase-2-key",
		api: "anthropic-messages",
		models: [
			{
				id: "mock-claude-sonnet",
				name: "Mock Claude Sonnet",
				reasoning: false,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 4096,
			},
			{
				id: "mock-claude-opus",
				name: "Mock Claude Opus",
				reasoning: true,
				input: ["text", "image"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 4096,
			},
		],
	});
}

export { BASE_URL, PROVIDER_ID };
