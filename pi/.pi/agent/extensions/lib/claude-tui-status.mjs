/**
 * Reads `claude-tui status --json` (contract: claude-tui docs/status-json.md).
 * Plain ESM with no dependencies so both .mjs and .ts callers can import it.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);
const DOWN = Object.freeze({ v: 1, daemon: "down" });

/** @type {{ at: number, value: object | undefined }} */
let cache = { at: 0, value: undefined };

/**
 * @param {{ exec?: Function, ttlMs?: number, now?: number }} [options]
 * @returns {Promise<object>} the parsed document, or `{ v: 1, daemon: "down" }`
 */
export async function claudeTuiStatus({ exec = execFileAsync, ttlMs = 15_000, now = Date.now() } = {}) {
	if (cache.value && now - cache.at < ttlMs) return cache.value;
	let value = DOWN;
	try {
		const bin = join(homedir(), ".cargo", "bin", "claude-tui");
		const { stdout } = await exec(bin, ["status", "--json"], { timeout: 2000 });
		const parsed = JSON.parse(stdout);
		if (parsed?.v === 1 && parsed.daemon !== "down") value = parsed;
	} catch {
		// Missing binary, timeout, non-JSON or wrong schema: treat as down.
	}
	cache = { at: now, value };
	return value;
}

/**
 * @param {{ cost_usd?: number | null, cost_source?: string } | undefined} totals
 * @returns {string}
 */
export function formatCost(totals) {
	const usd = totals?.cost_usd;
	if (usd == null || !Number.isFinite(usd)) return "?";
	let text;
	if (usd > 0 && usd < 0.01) text = `$${usd.toFixed(3)}`;
	else if (usd < 10) text = `$${usd.toFixed(2)}`;
	else text = `$${Math.round(usd)}`;
	return totals.cost_source === "computed" ? `≈${text}` : text;
}

/** Test hook: drop the cached document. */
export function resetClaudeTuiCache() {
	cache = { at: 0, value: undefined };
}
