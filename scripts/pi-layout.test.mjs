import assert from "node:assert/strict";
import { test } from "node:test";

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { AUTO_SIDE_WIDTH, inputsFromLayout, placePane, rebalancePlan, resolveLayout } from "./pi-layout.mjs";

const CLI = fileURLToPath(new URL("./pi-layout.mjs", import.meta.url));

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

// --- rebalance ---------------------------------------------------------------

const split = (direction, ratio, first, second) => ({ type: "split", direction, ratio, first, second });
const leaf = id => ({ type: "pane", pane_id: id });

test("rebalance ratios even out a right chain of three columns", () => {
	// right(A, right(B, C)) with ratios 0.5 / 0.5 gives A 50%; even is 1/3.
	const root = split("right", 0.5, leaf("A"), split("right", 0.5, leaf("B"), leaf("C")));
	assert.deepEqual(rebalancePlan(root), [{ path: [], ratio: 1 / 3 }]);
});

test("rebalance ratios treat a perpendicular subtree as one tile", () => {
	// right(down(A, B), C): two columns, so the root is 0.5 and the column is 0.5.
	const root = split("right", 0.3, split("down", 0.8, leaf("A"), leaf("B")), leaf("C"));
	assert.deepEqual(rebalancePlan(root), [{ path: [], ratio: 0.5 }, { path: [false], ratio: 0.5 }]);
});

test("rebalance ratios leave splits that hold a kept pane alone", () => {
	// Claude's 60% split stays; only the agents' column is evened.
	const root = split("right", 0.6, leaf("claude"), split("down", 0.7, leaf("g1"), leaf("g2")));
	assert.deepEqual(rebalancePlan(root, new Set(["claude"])), [{ path: [true], ratio: 0.5 }]);
});

test("rebalance ratios skip splits already within 0.01 of even", () => {
	assert.deepEqual(rebalancePlan(split("down", 0.505, leaf("A"), leaf("B"))), []);
});

test("rebalance without a socket exits 1 and prints nothing", () => {
	const result = spawnSync(process.execPath, [CLI, "rebalance", "wB:t1"], {
		encoding: "utf8",
		env: { ...process.env, HERDR_SOCKET_PATH: "" },
	});
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
});
