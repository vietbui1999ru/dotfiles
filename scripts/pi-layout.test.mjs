import assert from "node:assert/strict";
import { test } from "node:test";

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
	AUTO_SIDE_WIDTH,
	gridColumns,
	inputsFromLayout,
	planGridAdd,
	pickGridTab,
	placePane,
	rebalancePlan,
	resolveLayout,
	seriesLabel,
} from "./pi-layout.mjs";

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

test("side: the second agent halves the column beside Claude and the third overflows to the pi tab", () => {
	const first = pane("g1", 80, 60);
	const second = pane("g2", 80, 30);
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [first] }), {
		kind: "split", target: "g1", direction: "down", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [first, second] }), SPLIT_TAB);
});

test("below: the first agent splits the anchor downward, keeping Claude 60%", () => {
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [] }), {
		kind: "split", target: "claude", direction: "down", ratio: 0.6,
	});
});

test("below: the second agent halves the row beside Claude and the third overflows to the pi tab", () => {
	const first = pane("g1", 200, 24);
	const second = pane("g2", 100, 24);
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [first] }), {
		kind: "split", target: "g1", direction: "right", ratio: 0.5,
	});
	assert.deepEqual(placePane({ layout: "below", area, anchor, agents: [first, second] }), SPLIT_TAB);
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
	const agents = [pane("g1", 80, 60), pane("g2", 80, 30)];
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents, max: 1 }), SPLIT_TAB);
	assert.equal(placePane({ layout: "side", area, anchor, agents: agents.slice(0, 1) }).kind, "split");
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

// --- grid --------------------------------------------------------------------

const g = id => pane(id, 80, 60);
// A grid tab: a right chain of columns, each column a down chain of tiles.
const column = (...ids) => ids.slice(1).reduce((node, id) => split("down", 0.5, node, leaf(id)), leaf(ids[0]));
const columns = (...cols) => cols.slice(1).reduce((node, col) => split("right", 0.5, node, col), cols[0]);

test("third run goes to the pi tab", () => {
	const agents = [g("g1"), g("g2")]; // two agents already beside Claude
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents }), SPLIT_TAB);
});

test("side column is even", () => {
	// The second agent halves the first one's column (0.5), and Claude's split is untouched.
	assert.deepEqual(placePane({ layout: "side", area, anchor, agents: [g("g1")] }),
		{ kind: "split", target: "g1", direction: "down", ratio: 0.5 });
});

test("grid plan uses min(3, width/40) columns", () => {
	assert.equal(gridColumns(200), 3);
	assert.equal(gridColumns(100), 2);
	assert.equal(gridColumns(30), 1);
	assert.equal(gridColumns(0), 1);
});

test("grid plan fills row-major: a new column first, then the shortest column, leftmost on a tie", () => {
	const wide = { width: 200, height: 60 };
	// 1 tile in a 200-wide tab: the first column is full, so the next tile splits right.
	assert.deepEqual(planGridAdd(leaf("A"), wide), { kind: "split", target: "A", direction: "right" });
	// 2 columns of 1 and 1, 3 columns allowed: a third column opens to the right.
	assert.deepEqual(planGridAdd(columns(leaf("A"), leaf("B")), wide), { kind: "split", target: "B", direction: "right" });
	// 3 single-tile columns: all columns full at 3, so the shortest (leftmost) column grows down.
	assert.deepEqual(planGridAdd(columns(leaf("A"), leaf("B"), leaf("C")), wide), { kind: "split", target: "A", direction: "down" });
	// Columns of 2, 2 and 1: the shortest column (3rd) grows down at its bottom pane.
	assert.deepEqual(planGridAdd(columns(column("A", "B"), column("C", "D"), leaf("E")), wide),
		{ kind: "split", target: "E", direction: "down" });
});

test("grid plan reads herdr's right-nested column chain as separate columns", () => {
	const wide = { width: 199, height: 62 };
	// Splitting the rightmost pane right nests the chain on the right: right(A, right(B, C)).
	// With column 1 at two tiles, the next tile goes under B (column 2), not under A again.
	const tree = split("right", 0.333, split("down", 0.5, leaf("A"), leaf("A2")), split("right", 0.5, leaf("B"), leaf("C")));
	assert.deepEqual(planGridAdd(tree, wide), { kind: "split", target: "B", direction: "down" });
	// Three single tiles nested the same way: three columns are full, so A grows down.
	assert.deepEqual(planGridAdd(split("right", 0.333, leaf("A"), split("right", 0.5, leaf("B"), leaf("C"))), wide),
		{ kind: "split", target: "A", direction: "down" });
});

test("grid plan tolerates a tree that is not column-shaped", () => {
	// A down split with a right split inside it still names an existing leaf.
	const odd = split("down", 0.5, leaf("A"), split("right", 0.5, leaf("B"), leaf("C")));
	const decision = planGridAdd(odd, { width: 200, height: 60 });
	assert.equal(decision.kind, "split");
	assert.ok(["A", "B", "C"].includes(decision.target));
});

test("grid plan is full at 6 tiles or when a tile would drop under MIN_AGENT_HEIGHT", () => {
	const wide = { width: 200, height: 60 };
	const six = columns(column("A", "B"), column("C", "D"), column("E", "F"));
	assert.deepEqual(planGridAdd(six, wide), { kind: "full" });
	// Tiles at 15 rows: the next down split would leave two tiles of 7 rows, below 8.
	const tall = { width: 40, height: 15 };
	assert.deepEqual(planGridAdd(leaf("A"), tall), { kind: "full" });
	// Narrow tab: one column, so the next tile stacks down under it.
	assert.deepEqual(planGridAdd(leaf("A"), { width: 40, height: 60 }), { kind: "split", target: "A", direction: "down" });
});

test("grid overflow names the next tab", () => {
	assert.equal(seriesLabel("pi", 1), "pi");
	assert.equal(seriesLabel("verdict", 2), "verdict-2");
	const full = { tab_id: "w1:t2", label: "pi", root: columns(column("A", "B"), column("C", "D"), column("E", "F")), area: { width: 200, height: 60 } };
	const room = { tab_id: "w1:t3", label: "pi-2", root: leaf("G"), area: { width: 200, height: 60 } };
	// pi full, no pi-2: the next tab is pi-2.
	assert.deepEqual(pickGridTab("pi", [full]), { kind: "new-tab", label: "pi-2" });
	// pi full, pi-2 has room: split in pi-2.
	assert.deepEqual(pickGridTab("pi", [full, room]), { kind: "split", tab_id: "w1:t3", target: "G", direction: "right" });
	// verdict has no tab yet: a plain verdict tab.
	assert.deepEqual(pickGridTab("verdict", []), { kind: "new-tab", label: "verdict" });
});

test("running panes stay put", () => {
	// Every decision is a split of an existing leaf, the pi tab, or a new tab: never a move.
	const wide = { width: 200, height: 60 };
	const tree = columns(column("A", "B"), leaf("C"));
	const decision = planGridAdd(tree, wide);
	assert.equal(decision.kind, "split");
	assert.ok(["A", "B", "C"].includes(decision.target));
	// One agent beside Claude (a slot freed): the next dispatch splits beside Claude again.
	assert.equal(placePane({ layout: "side", area, anchor, agents: [g("g1")] }).kind, "split");
	assert.deepEqual(pickGridTab("pi", []), { kind: "new-tab", label: "pi" });
});
