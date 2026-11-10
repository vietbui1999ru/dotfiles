// Tests for the leader's up/down resize keys (herdr-app mods/leader/logic.js): the sidebar block
// dividers. Run: node --test scripts/leader-divider.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../herdr-app/.config/herdr-app/mods/leader/logic.js";

test("dividerTarget: j/k move the agents/focus divider, J/K the spaces/agents one", () => {
	assert.deepEqual(L.dividerTarget("j"), { above: "agents", below: "focus", delta: L.WEIGHT_STEP });
	assert.deepEqual(L.dividerTarget("k"), { above: "agents", below: "focus", delta: -L.WEIGHT_STEP });
	assert.deepEqual(L.dividerTarget("J"), { above: "spaces", below: "agents", delta: L.WEIGHT_STEP });
	assert.deepEqual(L.dividerTarget("K"), { above: "spaces", below: "agents", delta: -L.WEIGHT_STEP });
	assert.equal(L.dividerTarget("h"), null);
	assert.equal(L.dividerTarget("x"), null);
});

test("dividerTarget and resizeTarget never claim the same key", () => {
	for (const key of ["h", "l", "H", "L", "j", "k", "J", "K"]) {
		assert.ok(!(L.resizeTarget(key) && L.dividerTarget(key)), key);
	}
});

test("shiftWeights moves weight between the pair and keeps their sum", () => {
	assert.deepEqual(L.shiftWeights(2, 1, 0.25), [2.25, 0.75]);
	assert.deepEqual(L.shiftWeights(2, 1, -0.25), [1.75, 1.25]);
});

test("shiftWeights stops at the minimum on either side", () => {
	assert.deepEqual(L.shiftWeights(2.75, 0.25, 0.25), [2.75, 0.25]);
	assert.deepEqual(L.shiftWeights(0.25, 2.75, -0.25), [0.25, 2.75]);
	assert.deepEqual(L.shiftWeights(2.9, 0.1, 0.25), [2.75, 0.25], "a below-min side is lifted to min");
});

test("shiftWeights reads a non-finite weight as the minimum and a bad delta as zero", () => {
	assert.deepEqual(L.shiftWeights(NaN, 1, 0.25), [0.5, 0.75]);
	assert.deepEqual(L.shiftWeights(2, 1, NaN), [2, 1]);
});

test("weightOf reads a node's weight, null without one", () => {
	const tree = { id: "root", children: [{ id: "sidebar", size: { px: 268 }, children: [{ id: "agents", size: { weight: 2 } }] }] };
	assert.equal(L.weightOf(tree, "agents"), 2);
	assert.equal(L.weightOf(tree, "sidebar"), null);
	assert.equal(L.weightOf(tree, "missing"), null);
	assert.equal(L.weightOf(null, "agents"), null);
});

test("the defaults match the herdr-pi layout's sidebar blocks", () => {
	assert.deepEqual(L.SIDEBAR_BLOCKS, { spaces: 1, agents: 2, focus: 1 });
});

test("resizeBandState lists the divider keys after the sidebar and panel pairs", () => {
	const items = L.resizeBandState({ sidebar: 268, panel: 368 }).lines[0][0].items;
	assert.deepEqual(items.map((i) => i.keys), [["h", "l"], ["H", "L"], ["j", "k"], ["J", "K"]]);
});
