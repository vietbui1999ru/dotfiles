// Extension-level tests for the Headroom Pi extension (SPEC: feat/headroom, AC-4).
//
// The extension is loaded through Node's TypeScript type stripping with a mock
// ExtensionAPI and a fake fetch, so no proxy, no network and no real Pi session
// is involved. The invariant under test is that an enabled extension either
// registers the three supported providers with baseUrl+headers only, or stops
// startup — it never leaves a partial routing map behind.

import assert from "node:assert/strict";
import test from "node:test";

import extension, {
	applyRouting,
	checkReady,
} from "../../pi/.pi/agent/extensions/headroom.ts";

const BASE = "http://127.0.0.1:8787";

const IDENTITY = { service: "headroom-proxy", status: "healthy", alive: true, version: "0.24.0" };
const READY = { service: "headroom-proxy", status: "healthy", ready: true, version: "0.24.0" };

function json(body, status = 200) {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

/** fetch stub: routes -> (status, body), records requested URLs. */
function fakeFetch(routes) {
	const calls = [];
	const impl = async (url) => {
		calls.push(String(url));
		const key = new URL(String(url)).pathname;
		const hit = routes[key];
		if (!hit) return json({ error: "not found" }, 404);
		return json(hit[1], hit[0]);
	};
	impl.calls = calls;
	return impl;
}

function mockPi() {
	const registrations = [];
	return {
		registrations,
		registerProvider(name, config) {
			registrations.push([name, config]);
		},
	};
}

const HEALTHY = { "/livez": [200, IDENTITY], "/readyz": [200, READY] };

async function withEnv(vars, body) {
	const saved = {};
	for (const [key, value] of Object.entries(vars)) {
		saved[key] = process.env[key];
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
	try {
		return await body();
	} finally {
		for (const [key, value] of Object.entries(saved)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("inert without PI_HEADROOM: no registration, no network", async () => {
	const pi = mockPi();
	const originalFetch = globalThis.fetch;
	let fetched = 0;
	globalThis.fetch = async () => {
		fetched += 1;
		return json(IDENTITY);
	};
	try {
		await withEnv({ PI_HEADROOM: undefined, PI_HEADROOM_URL: BASE }, () => extension(pi));
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(pi.registrations, []);
	assert.equal(fetched, 0);
});

test("checkReady accepts a ready proxy and rejects a foreign listener", async () => {
	await checkReady(BASE, fakeFetch(HEALTHY));

	await assert.rejects(
		() => checkReady(BASE, fakeFetch({ "/livez": [200, { service: "some-other-service" }],
			"/readyz": [200, { service: "some-other-service", ready: true }] })),
		/is not a Headroom proxy/,
	);
});

test("checkReady rejects an unhealthy proxy even though /health would answer 200", async () => {
	await assert.rejects(
		() => checkReady(BASE, fakeFetch({
			"/livez": [200, IDENTITY],
			"/readyz": [503, { service: "headroom-proxy", ready: false }],
		})),
		/is not ready/,
	);
});

test("applyRouting registers exactly the three supported providers", () => {
	const pi = mockPi();
	const providers = applyRouting(pi, BASE);

	assert.deepEqual(providers.sort(), ["anthropic", "openai-codex", "opencode-go"]);
	assert.deepEqual(pi.registrations.map(([name]) => name).sort(), providers);
	for (const [name, config] of pi.registrations) {
		assert.deepEqual(Object.keys(config).sort(), ["baseUrl", "headers"], name);
		assert.match(config.headers["x-headroom-stack"], /^[a-z][a-z0-9_]{0,63}$/);
	}
	// The API-key provider must stay untouched.
	assert.ok(!pi.registrations.some(([name]) => name === "openai"));
});

test("enabled extension routes an enabled session end to end", async () => {
	const pi = mockPi();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = fakeFetch(HEALTHY);
	try {
		await withEnv({ PI_HEADROOM: "1", PI_HEADROOM_URL: BASE }, () => extension(pi));
	} finally {
		globalThis.fetch = originalFetch;
	}
	const byName = Object.fromEntries(pi.registrations);
	assert.equal(byName["openai-codex"].baseUrl, `${BASE}/backend-api`);
	assert.equal(byName["opencode-go"].baseUrl, `${BASE}/v1`);
	assert.equal(byName.anthropic.baseUrl, BASE);
});

test("enabled extension stops startup on an unready proxy, leaving nothing routed", async () => {
	const pi = mockPi();
	const originalFetch = globalThis.fetch;
	globalThis.fetch = fakeFetch({ "/livez": [200, IDENTITY], "/readyz": [503, { ready: false }] });
	try {
		await assert.rejects(
			() => withEnv({ PI_HEADROOM: "1", PI_HEADROOM_URL: BASE }, () => extension(pi)),
			/is not ready/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.deepEqual(pi.registrations, []);
});

test("enabled extension refuses a missing or remote URL before any request", async () => {
	const originalFetch = globalThis.fetch;
	let fetched = 0;
	globalThis.fetch = async () => {
		fetched += 1;
		return json(IDENTITY);
	};
	try {
		await assert.rejects(
			() => withEnv({ PI_HEADROOM: "1", PI_HEADROOM_URL: undefined },
				() => extension(mockPi())),
			/not set/,
		);
		await assert.rejects(
			() => withEnv({ PI_HEADROOM: "1", PI_HEADROOM_URL: "http://10.0.0.5:8787" },
				() => extension(mockPi())),
			/loopback/,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetched, 0, "no request may leave before the origin is validated");
});
