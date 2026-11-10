// Tests for the band's leader-state check and its normal height (herdr-app mods/ai-spend/format.js).
// Run: node --test scripts/ai-spend-band.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { leaderBand, bandPx } from "../herdr-app/.config/herdr-app/mods/ai-spend/format.js";

const item = { text: "h j k l", label: "focus" };
const map = { v: 1, mode: "map", lines: [[{ group: "Panes", items: [item] }]], note: "Esc cancels" };

test("leaderBand accepts a map state and a resize state", () => {
	assert.equal(leaderBand(map), map);
	const resize = { v: 1, mode: "resize", lines: [[{ group: "Resize", items: [{ text: "h l", label: "sidebar" }] }]], sizes: { sidebar: 268, panel: 368 } };
	assert.equal(leaderBand(resize), resize);
});

test("leaderBand rejects null, a wrong version, a missing lines array and an item without text", () => {
	assert.equal(leaderBand(null), null);
	assert.equal(leaderBand(undefined), null);
	assert.equal(leaderBand({ ...map, v: 2 }), null);
	assert.equal(leaderBand({ v: 1, mode: "map" }), null);
	assert.equal(leaderBand({ v: 1, mode: "map", lines: [[{ group: "Panes", items: [{ label: "focus" }] }]] }), null);
});

test("bandPx reads the band's px from the real herdr-pi layout", () => {
	const layout = JSON.parse(readFileSync(new URL("../herdr-app/.config/herdr-app/layouts/herdr-pi.json", import.meta.url), "utf8"));
	assert.equal(bandPx(layout), 24);
});

test("bandPx is null when the band is missing", () => {
	assert.equal(bandPx({ id: "root", children: [] }), null);
});
