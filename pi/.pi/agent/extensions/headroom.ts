// Headroom Pi extension — opt-in routing through the shared local proxy.
//
// Inert unless PI_HEADROOM is truthy, so every normal `pi` session stays direct
// (SPEC.md boundary: "Keep normal claude, codex, and pi commands direct").
// Launch through `headroom-workflow pi`, which sets the child-only env vars.
//
// Only { baseUrl, headers } is registered per provider. That is Pi's documented
// partial override: catalog, auth, api implementation and compat all survive.
// Never add models, apiKey, oauth or api here — that turns an endpoint override
// into a catalog replacement.
//
// Read lib/headroom-routing.ts before changing the map: it carries the measured
// reasons each provider gets the base path it gets.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	PROBE_TIMEOUT_MS,
	SERVICE,
	URL_ENV,
	assertLoopbackBase,
	isEnabled,
	probeUrls,
	routingMap,
} from "./lib/headroom-routing.ts";

type Registrar = Pick<ExtensionAPI, "registerProvider">;
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function getJson(url: string, fetchImpl: FetchLike): Promise<{ status: number; body: unknown }> {
	let response: Response;
	try {
		response = await fetchImpl(url, {
			headers: { Accept: "application/json" },
			// Mirror the launcher's probe: a redirect must not be mistaken for a
			// healthy proxy.
			redirect: "manual",
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`headroom: cannot reach ${url}: ${(error as Error).message}`);
	}
	// A body is parsed even on a non-200, exactly as the launcher's probe does, so
	// an unhealthy proxy reports *why* rather than a bare status code.
	let body: unknown = null;
	try {
		body = await response.json();
	} catch {
		body = null;
	}
	return { status: response.status, body };
}

/**
 * Confirm the origin is a ready Headroom proxy before any provider is routed.
 *
 * /health answers 200 even when unhealthy, so identity comes from /livez and
 * readiness from /readyz. A failure here must stop startup rather than leave a
 * partial routing setup in place.
 */
export async function checkReady(base: string, fetchImpl: FetchLike = fetch): Promise<void> {
	const { livez, readyz } = probeUrls(base);
	const live = await getJson(livez, fetchImpl);
	const identity = (live.body ?? {}) as { service?: unknown };
	if (live.status !== 200 || identity.service !== SERVICE) {
		throw new Error(
			`headroom: ${base} is not a Headroom proxy (GET /livez -> HTTP ${live.status}, ` +
				`service=${String(identity.service)})`,
		);
	}
	const ready = await getJson(readyz, fetchImpl);
	const state = (ready.body ?? {}) as { service?: unknown; ready?: unknown };
	if (ready.status !== 200 || state.service !== SERVICE || state.ready !== true) {
		throw new Error(
			`headroom: proxy at ${base} is not ready (GET /readyz -> HTTP ${ready.status}, ` +
				`ready=${String(state.ready)})`,
		);
	}
}

/** Register the routing map. Split out so tests can run it without a proxy. */
export function applyRouting(pi: Registrar, base: string): string[] {
	const routes = routingMap(base);
	for (const [provider, route] of Object.entries(routes)) {
		pi.registerProvider(provider, route);
	}
	return Object.keys(routes);
}

export default async function (pi: ExtensionAPI): Promise<void> {
	if (!isEnabled(process.env)) return;

	const base = assertLoopbackBase(process.env[URL_ENV]);
	await checkReady(base);
	const providers = applyRouting(pi, base);
	console.log(`[headroom] routing ${providers.join(", ")} through ${base}`);
}
