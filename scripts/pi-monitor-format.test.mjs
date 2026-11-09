// Run: node --test scripts/pi-monitor-format.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { capLines, cost, elapsed, firstLine, tokens } from "../herdr-app/.config/herdr-app/mods/pi-monitor/format.js";

test("elapsed gives <1m, minutes, hours and days", () => {
	assert.equal(elapsed(30000), "<1m");
	assert.equal(elapsed(12 * 60000), "12m");
	assert.equal(elapsed(3 * 3600000), "3h");
	assert.equal(elapsed(2 * 86400000), "2d");
});

test("tokens reads small, thousands and millions", () => {
	assert.equal(tokens(0), "0");
	assert.equal(tokens(950), "950");
	assert.equal(tokens(12400), "12.4k");
	assert.equal(tokens(12000), "12k");
	assert.equal(tokens(2200000), "2.2M");
});

test("cost shows four places under a cent, two above", () => {
	assert.equal(cost(0.0042), "$0.0042");
	assert.equal(cost(5.71), "$5.71");
	assert.equal(cost(undefined), "$0.0000");
});

test("capLines keeps 12 lines and says how many were cut", () => {
	const twelve = Array.from({ length: 12 }, (_, i) => `l${i}`).join("\n");
	assert.equal(capLines(twelve).length, 12);
	const fourteen = Array.from({ length: 14 }, (_, i) => `l${i}`).join("\n");
	const capped = capLines(fourteen);
	assert.equal(capped.length, 13);
	assert.equal(capped.at(-1), "… 2 more");
});

test("firstLine skips blank lines and trims", () => {
	assert.equal(firstLine("\n\n  first thought  \nsecond"), "first thought");
	assert.equal(firstLine(""), "");
});
