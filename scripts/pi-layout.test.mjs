import assert from "node:assert/strict";
import { test } from "node:test";

import { AUTO_SIDE_WIDTH, inputsFromLayout, placePane, resolveLayout } from "./pi-layout.mjs";

const pane = (id, width, height) => ({ pane_id: id, width, height });
const area = { width: 200, height: 60 };
const anchor = pane("claude", 200, 60);
const SPLIT_TAB = { kind: "tab" };

test("side: the first agent splits the anchor to the right, keeping Claude 60%", () => {
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [] }), {
		kind: "split", target: "claude", direction: "right", ratio: 0.6,
	});
});

test("side: later agents stack down the right column and the fourth overflows to the pi tab", () => {
	const first = pane("g1", 80, 60);
	const second = pane("g2", 80, 30);
	const third = pane("g3", 80, 15);
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [first] }), {
		kind: "split", target: "g1", direction: "down", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [first, second] }), {
		kind: "split", target: "g2", direction: "down", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [first, second, third] }), SPLIT_TAB);
});

test("below: the first agent splits the anchor downward, keeping Claude 60%", () => {
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [] }), {
		kind: "split", target: "claude", direction: "down", ratio: 0.6,
	});
});

test("below: later agents line up left to right and the fourth overflows to the pi tab", () => {
	const first = pane("g1", 200, 24);
	const second = pane("g2", 100, 24);
	const third = pane("g3", 50, 24);
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [first] }), {
		kind: "split", target: "g1", direction: "right", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [first, second] }), {
		kind: "split", target: "g2", direction: "right", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [first, second, third] }), SPLIT_TAB);
});

test("a first agent that would fall below the minimum size overflows instead", () => {
	// side: the new column needs 40 columns and Claude keeps 60.
	assert.deepEqual(placePane({ layout: "side", area: { width: 100, height: 60 }, anchor: pane("claude", 100, 60), agents: [] }), {
		kind: "split", target: "claude", direction: "right", ratio: 0.6,
	});
	assert.deepEqual(placePane({ layout: "side", area: { width: 99, height: 60 }, anchor: pane("claude", 99, 60), agents: [] }), SPLIT_TAB);
	// below: the new row needs 8 rows and Claude keeps 12.
	assert.deepEqual(placePane({ layout: "below", area, anchor: pane("claude", 200, 20), agents: [] }), {
		kind: "split", target: "claude", direction: "down", ratio: 0.6,
	});
	assert.deepEqual(placePane({ layout: "below", area, anchor: pane("claude", 200, 19), agents: [] }), SPLIT_TAB);
});

test("a later agent that would fall below the minimum size overflows instead", () => {
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [pane("g1", 80, 15)] }), SPLIT_TAB);
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [pane("g1", 79, 24)] }), SPLIT_TAB);
	assert.equal(placePane({ layout: "side", area, anchor, agents: [pane("g1", 80, 16)] }).kind, "split");
	assert.equal(placePane({ layout: "below", area, anchor, agents: [pane("g1", 80, 24)] }).kind, "split");
});

test("auto picks side only from 160 columns", () => {
	const narrow = { width: AUTO_SIDE_WIDTH - 1, height: 60 };
	const wide = { width: AUTO_SIDE_WIDTH, height: 60 };
	assert.equal(resolveLayout("auto", narrow), "below");
	assert.equal(resolveLayout("auto", wide), "side");
	assert.equal(placePane({ layout: "auto", area: narrow, anchor: pane("claude", narrow.width, 60), agents: [] }).direction, "down");
	assert.equal(placePane({ layout: "auto", area: wide, anchor: pane("claude", wide.width, 60), agents: [] }).direction, "right");
	assert.equal(resolveLayout("side", narrow), "side");
});

test("tab always returns the pi tab, however much room there is", () => {
	assert.deepEqual(placePane({ layout: "tab", area, anchor, agents: [] }), SPLIT_TAB);
	assert.deepEqual(placePane({ layout: "tab", area, anchor, agents: [pane("g1", 80, 60)] }), SPLIT_TAB);
	assert.deepEqual(placePane({ layout: "tab", area: { width: 400, height: 200 }, anchor: pane("claude", 400, 200), agents: [] }), SPLIT_TAB);
});

test("an unknown layout falls back to the pi tab", () => {
	assert.deepEqual(placePane({ layout: "diagonal", area, anchor, agents: [] }), SPLIT_TAB);
});

test("the agent limit is the max, and it can be lowered", () => {
	const agents = [pane("g1", 80, 60), pane("g2", 80, 30), pane("g3", 80, 15)];
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: agents.slice(0, 2), max: 2 }), SPLIT_TAB);
	assert.equal(placePane({ layout: "side", area, anchor, agents: agents.slice(0, 2) }).kind, "split");
});

test("layout input keeps the opened order and drops panes that left the tab", () => {
	const layout = {
		area: { width: 200, height: 60, x: 0, y: 0 },
		tab_id: "w1:t2",
		panes: [
			{ pane_id: "claude", rect: { width: 200, height: 60, x: 0, y: 0 } },
			{ pane_id: "g1", rect: { width: 80, height: 60, x: 120, y: 0 } },
			{ pane_id: "g2", rect: { width: 80, height: 30, x: 120, y: 30 } },
		],
	};
	assert.deepEqual(inputsFromLayout(layout, "claude", ["g2", "gone", "g1"]), {
		area: layout.area,
		anchor: { pane_id: "claude", width: 200, height: 60, x: 0, y: 0 },
		agents: [
			{ pane_id: "g2", width: 80, height: 30, x: 120, y: 30 },
			{ pane_id: "g1", width: 80, height: 60, x: 120, y: 0 },
		],
	});
	assert.equal(inputsFromLayout(layout, "elsewhere", []), undefined);
});
