// Tests for the leader's band states (herdr-app mods/leader/logic.js: the hint lines, the resize
// state, hasBand). Run: node --test scripts/leader-band.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../herdr-app/.config/herdr-app/mods/leader/logic.js";

const itemsOf = (state) => state.lines.flat().flatMap((g) => g.items);

test("every LEADER_MAP key appears in exactly one band item", () => {
	const keys = itemsOf(L.mapBandState()).flatMap((i) => i.keys);
	for (const key of Object.keys(L.LEADER_MAP)) {
		assert.equal(keys.filter((k) => k === key).length, 1, `key ${key}`);
	}
	assert.equal(keys.length, Object.keys(L.LEADER_MAP).length);
});

test("HINT_LINES covers every group exactly once", () => {
	const groups = L.HINT_LINES.flat();
	assert.deepEqual([...groups].sort(), [...L.GROUPS].sort());
});

test("Panes merges the focus keys into h j k l with the label focus", () => {
	const panes = L.hintItems("Panes");
	assert.ok(panes.some((i) => i.text === "h j k l" && i.label === "focus"));
});

test("Tabs merges the digit keys into 1–9 labelled tab", () => {
	const tabs = L.hintItems("Tabs");
	assert.ok(tabs.some((i) => i.text === "1–9" && i.label === "tab"));
});

test("s and v are not merged: they share a group but not a run of one command", () => {
	const panes = L.hintItems("Panes");
	const s = panes.find((i) => i.keys.includes("s"));
	const v = panes.find((i) => i.keys.includes("v"));
	assert.deepEqual(s.keys, ["s"]);
	assert.deepEqual(v.keys, ["v"]);
});

test("resizeBandState gives the sidebar and panel key pairs and passes the sizes through", () => {
	const state = L.resizeBandState({ sidebar: 268, panel: null });
	const items = state.lines[0][0].items;
	assert.deepEqual(items[0].keys, ["h", "l"]);
	assert.deepEqual(items[1].keys, ["H", "L"]);
	assert.deepEqual(state.sizes, { sidebar: 268, panel: null });
});

test("resizeBandState key signs match resizeTarget", () => {
	const state = L.resizeBandState({ sidebar: 268, panel: 368 });
	const [sidebar, panel] = state.lines[0][0].items;
	assert.match(sidebar.label, /sidebar −40 \+40/);
	assert.match(panel.label, /panel \+40 −40/);
	assert.equal(L.resizeTarget("h").delta, -L.RESIZE_STEP);
	assert.equal(L.resizeTarget("l").delta, L.RESIZE_STEP);
	assert.equal(L.resizeTarget("H").delta, L.RESIZE_STEP);
	assert.equal(L.resizeTarget("L").delta, -L.RESIZE_STEP);
});

test("both band states carry v === 1", () => {
	assert.equal(L.mapBandState().v, 1);
	assert.equal(L.resizeBandState({}).v, 1);
});

test("hasBand is true for a shown ai-spend and false when hidden or missing", () => {
	assert.equal(L.hasBand({ id: "root", children: [{ id: "ai-spend" }] }), true);
	assert.equal(L.hasBand({ id: "root", children: [{ id: "ai-spend", hidden: true }] }), false);
	assert.equal(L.hasBand({ id: "root", children: [] }), false);
	assert.equal(L.hasBand(null), false);
});

test("BAND_PX is 24 and BAND_HINTS_PX is 48", () => {
	assert.equal(L.BAND_PX, 24);
	assert.equal(L.BAND_HINTS_PX, 48);
});
