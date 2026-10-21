import { describe, test, expect, beforeEach } from "bun:test";
import { claudeTuiStatus, formatCost, resetClaudeTuiCache } from "./claude-tui-status.mjs";

const reachable = { v: 1, subscriptions: { "opencode-go": null }, generated_at: "x" };

beforeEach(() => resetClaudeTuiCache());

describe("claudeTuiStatus", () => {
	test("reports down when exec throws", async () => {
		const exec = async () => { throw new Error("ENOENT"); };
		expect(await claudeTuiStatus({ exec })).toEqual({ v: 1, daemon: "down" });
	});

	test("reports down on the down shape", async () => {
		const exec = async () => ({ stdout: '{"v":1,"daemon":"down"}' });
		expect(await claudeTuiStatus({ exec })).toEqual({ v: 1, daemon: "down" });
	});

	test("reports down on non-JSON or unknown schema version", async () => {
		resetClaudeTuiCache();
		expect(await claudeTuiStatus({ exec: async () => ({ stdout: "nope" }) })).toEqual({ v: 1, daemon: "down" });
		resetClaudeTuiCache();
		expect(await claudeTuiStatus({ exec: async () => ({ stdout: '{"v":2,"subscriptions":{}}' }) })).toEqual({ v: 1, daemon: "down" });
	});

	test("returns the parsed document", async () => {
		const exec = async () => ({ stdout: JSON.stringify(reachable) });
		expect(await claudeTuiStatus({ exec })).toEqual(reachable);
	});

	test("caches within the TTL, including down results", async () => {
		let calls = 0;
		const exec = async () => { calls++; throw new Error("down"); };
		await claudeTuiStatus({ exec, now: 1000 });
		await claudeTuiStatus({ exec, now: 5000 });
		expect(calls).toBe(1);
		await claudeTuiStatus({ exec, now: 1000 + 15_000 });
		expect(calls).toBe(2);
	});
});

describe("formatCost", () => {
	test("reported cost has no marker", () => {
		expect(formatCost({ cost_usd: 4.70984316, cost_source: "reported" })).toBe("$4.71");
	});
	test("computed cost is marked as API-equivalent", () => {
		expect(formatCost({ cost_usd: 101.46, cost_source: "computed" })).toBe("≈$101");
	});
	test("null or missing cost is ?", () => {
		expect(formatCost({ cost_usd: null, cost_source: "unknown" })).toBe("?");
		expect(formatCost(undefined)).toBe("?");
	});
	test("sub-cent values keep three decimals", () => {
		expect(formatCost({ cost_usd: 0.00514, cost_source: "reported" })).toBe("$0.005");
	});
	test("zero is a plain two-decimal amount, not a sub-cent one", () => {
		expect(formatCost({ cost_usd: 0, cost_source: "reported" })).toBe("$0.00");
	});
});
