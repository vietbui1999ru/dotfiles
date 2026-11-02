// Pure routing tests for the Headroom Pi extension (SPEC: feat/headroom, AC-6).
//
// These exercise pi/.pi/agent/extensions/lib/headroom-routing.ts directly through
// Node's TypeScript type stripping: no proxy, no Pi runtime, no credentials.

import assert from "node:assert/strict";
import test from "node:test";

import {
	ROUTED_PROVIDERS,
	STACK_SLUG,
	assertLoopbackBase,
	isEnabled,
	probeUrls,
	routingMap,
	stackSlug,
} from "../../pi/.pi/agent/extensions/lib/headroom-routing.ts";

const BASE = "http://127.0.0.1:8787";

test("every route registers only baseUrl and headers", () => {
	for (const [provider, route] of Object.entries(routingMap(BASE))) {
		assert.deepEqual(
			Object.keys(route).sort(),
			["baseUrl", "headers"],
			`${provider} must not replace catalog or auth fields`,
		);
		assert.deepEqual(Object.keys(route.headers), ["x-headroom-stack"]);
	}
});

test("openai is never routed, because its key belongs to a different vendor", () => {
	assert.ok(!ROUTED_PROVIDERS.includes("openai"));
	assert.equal(routingMap(BASE).openai, undefined);
});

test("codex uses the backend-api base so its WebSocket route survives", () => {
	const codex = routingMap(BASE)["openai-codex"];
	assert.equal(codex.baseUrl, `${BASE}/backend-api`);
	// headroom registers a WS route at exactly this path.
	assert.equal(`${codex.baseUrl}/codex/responses`, `${BASE}/backend-api/codex/responses`);
});

test("opencode-go and anthropic use the plain v1 / origin bases", () => {
	assert.equal(routingMap(BASE)["opencode-go"].baseUrl, `${BASE}/v1`);
	assert.equal(routingMap(BASE).anthropic.baseUrl, BASE);
});

test("stack slugs satisfy headroom's validator and are unique", () => {
	const slugs = ROUTED_PROVIDERS.map((provider) => stackSlug(provider));
	for (const slug of slugs) {
		assert.ok(STACK_SLUG.test(slug), `${slug} would be dropped by /livez attribution`);
	}
	assert.equal(new Set(slugs).size, slugs.length);
	assert.deepEqual(slugs, ["pi_claude", "pi_codex", "pi_opencode"]);
	// A hyphenated slug is the failure mode this guards against.
	assert.ok(!STACK_SLUG.test("pi-claude"));
});

test("probe paths are derived from the bare origin", () => {
	assert.deepEqual(probeUrls(BASE), { livez: `${BASE}/livez`, readyz: `${BASE}/readyz` });
});

test("assertLoopbackBase accepts loopback origins with an explicit port", () => {
	assert.equal(assertLoopbackBase("http://127.0.0.1:8787"), BASE);
	assert.equal(assertLoopbackBase("http://127.0.0.1:8787/"), BASE);
	assert.equal(assertLoopbackBase("http://localhost:8787"), "http://localhost:8787");
	assert.equal(assertLoopbackBase(" http://127.0.0.1:8787 "), BASE);
});

test("assertLoopbackBase refuses anything that could leak credentials", () => {
	const cases = [
		["", /not set/],
		["not a url", /not a URL/],
		["https://127.0.0.1:8787", /plain http/],
		["http://user:pass@127.0.0.1:8787", /credentials/],
		["http://127.0.0.1:8787/v1", /bare origin/],
		["http://127.0.0.1", /explicit port/],
		["http://10.0.0.5:8787", /loopback/],
		["http://evil.example:8787", /loopback/],
	];
	for (const [value, pattern] of cases) {
		assert.throws(() => assertLoopbackBase(value), pattern, `accepted ${JSON.stringify(value)}`);
	}
});

test("isEnabled only answers to explicit opt-in values", () => {
	for (const value of ["1", "true", "YES", "on", " true "]) {
		assert.equal(isEnabled({ PI_HEADROOM: value }), true, value);
	}
	for (const value of [undefined, "", "0", "false", "no", "off"]) {
		assert.equal(isEnabled({ PI_HEADROOM: value }), false, String(value));
	}
});
