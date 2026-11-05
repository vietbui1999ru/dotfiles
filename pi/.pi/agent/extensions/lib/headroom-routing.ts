// Headroom routing for the shared proxy pilot (SPEC: feat/headroom, AC-4..AC-6).
//
// Pure mapping and validation only — no network, no Pi runtime imports — so the
// node tests in scripts/tests/ can exercise it directly.
//
// The routing facts encoded here were verified against headroom 0.24.0 and pi
// 1.4.0 and are not obvious from either side's documentation:
//
//   1. The ChatGPT upstream is chosen by AUTH SHAPE, not by path or client:
//      headroom takes the chatgpt.com branch when a `chatgpt-account-id` header
//      is present (Pi's openai-codex provider sends it; so does the Codex CLI).
//      That is why both Codex clients survive a proxy whose OpenAI-shaped target
//      is pinned to OpenCode Go.
//   2. `x-headroom-base-url` does NOT reroute /v1/chat/completions — a request
//      carrying it reached api.openai.com with the OpenCode key attached. The
//      header is read only by the catch-all route, which forwards raw and skips
//      compression. So opencode-go rides the pinned target and never asks the
//      proxy for a different upstream.
//   3. Pi's openai-codex speaks WebSocket on base + "/codex/responses", and
//      headroom registers a WS route at /backend-api/codex/responses — the one
//      place that keeps the transport alive. Hence its base is `${base}/backend-api`
//      and not `${base}/v1`.
//   4. `x-headroom-stack` is validated as ^[a-z][a-z0-9_]{0,63}$ and a rejected
//      value is dropped silently, so slugs are underscore-only (a hyphenated
//      slug loses attribution without any error).
//
// Pi's `openai` provider is deliberately absent: its API key belongs to a
// different vendor than the pinned target, so overriding its base is the one
// misroute this design must not create.

export const ENABLE_ENV = "PI_HEADROOM";
export const URL_ENV = "PI_HEADROOM_URL";
export const STACK_HEADER = "x-headroom-stack";
export const SERVICE = "headroom-proxy";
export const PROBE_TIMEOUT_MS = 2_000;

/** Headroom drops stack values that do not match this, without an error. */
export const STACK_SLUG = /^[a-z][a-z0-9_]{0,63}$/;

export const ROUTED_PROVIDERS = ["anthropic", "openai-codex", "opencode-go"] as const;
export type RoutedProvider = (typeof ROUTED_PROVIDERS)[number];

export interface ProviderRoute {
	baseUrl: string;
	headers: Record<string, string>;
}

/** Stack slug per routed provider; unlisted providers are never routed. */
const STACKS: Record<RoutedProvider, string> = {
	anthropic: "pi_claude",
	"openai-codex": "pi_codex",
	"opencode-go": "pi_opencode",
};

/** Provider-specific base path, given the proxy origin. */
const BASES: Record<RoutedProvider, (base: string) => string> = {
	anthropic: (base) => base,
	// WebSocket route lives under /backend-api (fact 3).
	"openai-codex": (base) => `${base}/backend-api`,
	"opencode-go": (base) => `${base}/v1`,
};

export function isEnabled(env: Record<string, string | undefined>): boolean {
	const raw = (env[ENABLE_ENV] ?? "").trim().toLowerCase();
	return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Validate the proxy origin handed down by scripts/headroom-workflow.
 *
 * The launcher already rejects non-loopback URLs; this is the second gate, so an
 * extension loaded by hand cannot leak provider credentials to a remote host.
 */
export function assertLoopbackBase(raw: string | undefined): string {
	const value = (raw ?? "").trim();
	if (!value) {
		throw new Error(
			`headroom: ${URL_ENV} is not set; run \`headroom-workflow pi\` instead of exporting it by hand`,
		);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`headroom: ${URL_ENV} ${value} is not a URL`);
	}
	if (url.protocol !== "http:") {
		throw new Error(`headroom: ${URL_ENV} must be a plain http:// origin`);
	}
	if (url.username || url.password) {
		throw new Error(`headroom: ${URL_ENV} must not embed credentials`);
	}
	if (url.pathname !== "/" && url.pathname !== "") {
		throw new Error(`headroom: ${URL_ENV} must be a bare origin, without a path`);
	}
	const host = url.hostname.toLowerCase();
	const loopback =
		host === "localhost" ||
		host === "::1" ||
		host === "[::1]" ||
		/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
	if (!loopback) {
		throw new Error(`headroom: ${URL_ENV} must be loopback, not ${host}`);
	}
	if (!url.port) {
		throw new Error(`headroom: ${URL_ENV} must include an explicit port`);
	}
	return `http://${host}:${url.port}`;
}

export function stackSlug(provider: RoutedProvider): string {
	const slug = STACKS[provider];
	if (!STACK_SLUG.test(slug)) {
		// Unreachable for the constants above; kept so a future edit fails loudly
		// instead of silently losing /stats attribution.
		throw new Error(`headroom: invalid stack slug ${slug} for ${provider}`);
	}
	return slug;
}

export function routeFor(provider: RoutedProvider, base: string): ProviderRoute {
	return {
		baseUrl: BASES[provider](base),
		headers: { [STACK_HEADER]: stackSlug(provider) },
	};
}

/** The exact registration map. Only baseUrl and headers — never models or auth. */
export function routingMap(base: string): Record<RoutedProvider, ProviderRoute> {
	const routes = {} as Record<RoutedProvider, ProviderRoute>;
	for (const provider of ROUTED_PROVIDERS) {
		routes[provider] = routeFor(provider, base);
	}
	return routes;
}

export function probeUrls(base: string): { livez: string; readyz: string } {
	return { livez: `${base}/livez`, readyz: `${base}/readyz` };
}
