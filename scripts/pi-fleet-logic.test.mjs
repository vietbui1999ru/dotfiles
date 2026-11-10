// Run: node --test scripts/pi-fleet-logic.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	approveMessage,
	canClose,
	cleanupRows,
	duration,
	displayedOrder,
	mergeAgentRows,
	modelFrom,
	nextAddress,
	piRows,
	planSync,
	removeMessage,
	reviewRows,
	spawnArgs,
	byUrgency,
	pinnedFirst,
	pruneChanged,
	subTree,
	taskFileName,
	windowSpec,
} from "../herdr-app/.config/herdr-app/mods/pi-fleet/logic.js";

const term = (address, labels = {}, extra = {}) => ({
	address,
	name: extra.name ?? address,
	argv: extra.argv ?? [],
	status: extra.status ?? null,
	labels,
});

test("piRows skips terminals whose state is not live", () => {
  const rows = piRows([
    { ...term("t1", { "pi.session": "a" }), state: "exited" },
    { ...term("t2", { "pi.session": "b" }), state: "live" },
    term("t3", { "pi.session": "c" }),
  ]);
  assert.deepEqual(rows.map((r) => r.address), ["t2", "t3"]);
});

test("piRows carries created_ms as createdMs, undefined when absent", () => {
  const [a, b] = piRows([
    { ...term("t1", { "pi.session": "a" }), created_ms: 1234 },
    term("t2", { "pi.session": "b" }),
  ]);
  assert.equal(a.createdMs, 1234);
  assert.equal(b.createdMs, undefined);
});

test("piRows keeps only terminals labelled pi.session", () => {
	const rows = piRows([
		term("t3", { "pi.session": "a" }),
		term("t9", { other: "x" }),
		term("pve2/t3", { "pi.session": "b" }),
	]);
	assert.deepEqual(rows.map((r) => r.address), ["t3", "pve2/t3"]);
});

test("piRows sorts by machine, then address; local has no machine prefix", () => {
	const rows = piRows([
		term("t12", { "pi.session": "a" }),
		term("pve2/t3", { "pi.session": "b" }),
		term("t2", { "pi.session": "c" }),
	]);
	assert.deepEqual(rows.map((r) => [r.machine, r.address]), [
		["local", "t12"],
		["local", "t2"],
		["pve2", "pve2/t3"],
	]);
});

test("piRows reads name without pueue-, model, status and isWindow", () => {
	const [row] = piRows([
		term("pve2/t3", { "pi.session": "s", "pi.window": "1" }, {
			name: "pueue-fix-login",
			argv: ["pi", "--model", "opencode-go/claude-haiku-5-5:off"],
			status: "working",
		}),
	]);
	assert.equal(row.name, "fix-login");
	assert.equal(row.model, "claude-haiku-5-5");
	assert.equal(row.status, "working");
	assert.equal(row.isWindow, true);
	assert.equal(row.machine, "pve2");
});

test("piRows gives null status and isWindow false when unlabelled", () => {
	const [row] = piRows([term("t1", { "pi.session": "s" }, { name: "x" })]);
	assert.equal(row.status, null);
	assert.equal(row.isWindow, false);
});

test("piRows returns an empty list for no terminals", () => {
	assert.deepEqual(piRows([]), []);
	assert.deepEqual(piRows(undefined), []);
});

test("modelFrom strips the provider and thinking level", () => {
	assert.equal(modelFrom(["pi", "--model", "opencode-go/claude-haiku-5-5:off"]), "claude-haiku-5-5");
	assert.equal(modelFrom(["pi", "--model", "anthropic/claude-opus-4:high"]), "claude-opus-4");
	assert.equal(modelFrom(["pi", "--model", "plain-model"]), "plain-model");
});

test("modelFrom returns viewer without --model", () => {
	assert.equal(modelFrom(["tail", "-f", "log"]), "viewer");
	assert.equal(modelFrom(["pi", "--model"]), "viewer");
	assert.equal(modelFrom([]), "viewer");
});

test("windowSpec keys the window by address and keeps it", () => {
	const spec = windowSpec("pve2/t3", 0);
	assert.equal(spec.kind, "window");
	assert.equal(spec.key, "pve2/t3");
	assert.equal(spec.keep, true);
	assert.equal(spec.width, 720);
	assert.equal(spec.height, 440);
});

test("windowSpec cascades and wraps at 8", () => {
	assert.deepEqual(windowSpec("t1", 0).at, { x: 340, y: 80 });
	assert.deepEqual(windowSpec("t1", 1).at, { x: 364, y: 104 });
	assert.deepEqual(windowSpec("t1", 7).at, { x: 340 + 24 * 7, y: 80 + 24 * 7 });
	assert.deepEqual(windowSpec("t1", 8).at, { x: 340, y: 80 });
});

test("windowSpec is a drag bar over the terminal in a column", () => {
	const { layout } = windowSpec("pve2/t3", 0);
	assert.equal(layout.type, "column");
	assert.deepEqual(layout.children[0], {
		type: "block",
		size: { px: 28 },
		content: { mod: "pi-window-bar", props: { terminal: "pve2/t3" } },
	});
	assert.deepEqual(layout.children[1], { type: "block", content: { terminal: "pve2/t3" } });
});

test("nextAddress wraps, starts at the first row when current is unlisted, null when empty", () => {
	const rows = [{ address: "t1" }, { address: "t2" }, { address: "t3" }];
	assert.equal(nextAddress(rows, "t1"), "t2");
	assert.equal(nextAddress(rows, "t3"), "t1");
	assert.equal(nextAddress(rows, "gone"), "t1");
	assert.equal(nextAddress(rows, undefined), "t1");
	assert.equal(nextAddress([], "t1"), null);
});

test("planSync opens a new window row", () => {
	const rows = piRows([term("t1", { "pi.session": "a", "pi.window": "1" })]);
	assert.deepEqual(planSync({ rows, opened: [], dismissed: [] }).open, ["t1"]);
});

test("planSync does not reopen an already opened window", () => {
	const rows = piRows([term("t1", { "pi.session": "a", "pi.window": "1" })]);
	assert.deepEqual(planSync({ rows, opened: ["t1"], dismissed: [] }).open, []);
});

test("planSync does not open a dismissed window", () => {
	const rows = piRows([term("t1", { "pi.session": "a", "pi.window": "1" })]);
	assert.deepEqual(planSync({ rows, opened: [], dismissed: ["t1"] }).open, []);
});

test("planSync never opens a non-window row", () => {
	const rows = piRows([term("t1", { "pi.session": "a" })]);
	assert.deepEqual(planSync({ rows, opened: [], dismissed: [] }).open, []);
});

test("planSync drops vanished addresses from opened and dismissed", () => {
	const rows = piRows([term("t1", { "pi.session": "a", "pi.window": "1" })]);
	const plan = planSync({ rows, opened: ["t1", "gone"], dismissed: ["gone2", "t1"] });
	assert.deepEqual(plan.opened, ["t1"]);
	assert.deepEqual(plan.dismissed, ["t1"]);
	assert.deepEqual(plan.open, []);
});

test("taskFileName takes the first three words, slugged, with the stamp", () => {
	assert.equal(taskFileName("Fix the login bug today", 123), "fix-the-login-123.md");
	assert.equal(taskFileName("  Hello, World!  ", 9), "hello-world-9.md");
	assert.equal(taskFileName("a", 5), "a-5.md");
});

test("taskFileName falls back to task when nothing remains", () => {
	assert.equal(taskFileName("!!! ???", 7), "task-7.md");
	assert.equal(taskFileName("", 7), "task-7.md");
});

test("spawnArgs has no --on for local", () => {
	assert.deepEqual(
		spawnArgs({ tier: "low", taskFile: "/t.md", folder: "/repo", machine: "local" }),
		["--tier", "low", "--task-file", "/t.md", "--cwd", "/repo"],
	);
});

test("spawnArgs adds --on for another machine", () => {
	assert.deepEqual(
		spawnArgs({ tier: "high", taskFile: "/t.md", folder: "/repo", machine: "pve2" }),
		["--tier", "high", "--task-file", "/t.md", "--cwd", "/repo", "--on", "pve2"],
	);
});

test("duration formats minutes, hours and days as the agents mod does", () => {
  assert.equal(duration(30000), "<1m");
  assert.equal(duration(12 * 60000), "12m");
  assert.equal(duration(3 * 3600000), "3h");
  assert.equal(duration(2 * 86400000), "2d");
});

const review = (over) => ({ runId: "abcdef123456", owner: "/w", branch: "b", name: "n", startedAt: "2026-11-02", ...over });

test("reviewRows drops runs that cannot be approved", () => {
	for (const over of [{ orphan: true }, { processing: true }, { error: true }, { landed: true }, { owner: null }]) {
		assert.deepEqual(reviewRows([review(over)]), []);
	}
	assert.deepEqual(reviewRows("nope"), []);
	assert.deepEqual(reviewRows([null]), []);
});

test("reviewRows names a run by name, then branch, then short id, oldest first", () => {
	assert.equal(reviewRows([review()])[0].name, "n");
	assert.equal(reviewRows([review({ name: "" })])[0].name, "b");
	assert.equal(reviewRows([review({ name: "", branch: "" })])[0].name, "abcdef12");
	const order = reviewRows([review({ runId: "new", startedAt: "2026-11-09" }), review({ runId: "old", startedAt: "2026-11-01" })]);
	assert.deepEqual(order.map((r) => r.runId), ["old", "new"]);
});

test("approveMessage is null only for an exit 0 with ok true", () => {
	assert.equal(approveMessage(0, '{"ok":true}'), null);
	assert.equal(approveMessage(2, '{"ok":true}'), "Approve failed");
	assert.equal(approveMessage(0, '{"ok":false}'), "Approve failed");
	assert.equal(approveMessage(2, '{"ok":false,"reason":"not-confirmed","message":"x"}'), "Cancelled");
	assert.equal(approveMessage(2, '{"ok":false,"reason":"tree-changed","message":"changed"}'), "changed");
	assert.equal(approveMessage(1, "not json"), "Approve failed");
});

test("cleanupRows keeps landed and orphan runs with a directory, oldest first", () => {
	const rows = cleanupRows([
		{ runId: "new", landed: true, owner: "/w/a", branch: "x", startedAt: "2026-11-09" },
		{ runId: "old", orphan: true, owner: null, repo: "/repo", name: "", branch: "b", startedAt: "2026-11-01" },
		{ runId: "busy", landed: true, owner: "/w/c", processing: true, startedAt: "2026-11-02" },
		{ runId: "open", owner: "/w/d", startedAt: "2026-11-03" },
		{ runId: "nocwd", orphan: true, owner: null, repo: null, startedAt: "2026-11-04" },
	]);
	assert.deepEqual(rows.map((r) => r.runId), ["old", "new"]);
	assert.equal(rows[0].cwd, "/repo");
	assert.equal(rows[0].kind, "orphan");
	assert.equal(rows[0].name, "b");
	assert.equal(rows[1].kind, "landed");
	assert.equal(rows[1].cwd, "/w/a");
});

test("cleanupRows names an unnamed run by its short id and handles non-arrays", () => {
	assert.equal(cleanupRows([{ runId: "abcdef123456", landed: true, owner: "/w" }])[0].name, "abcdef12");
	assert.deepEqual(cleanupRows(undefined), []);
	assert.deepEqual(cleanupRows({}), []);
});

test("removeMessage is null only for an exit 0 with ok true", () => {
	assert.equal(removeMessage(0, '{"ok":true}'), null);
	assert.equal(removeMessage(2, '{"ok":false,"reason":"x","message":"Still open"}'), "Still open");
	assert.equal(removeMessage(2, '{"ok":false}'), "Remove failed");
	assert.equal(removeMessage(1, "not json"), "Remove failed");
});

test("canClose needs a settled run: a turn taken and idle or done", () => {
	assert.equal(canClose({ turn: 1, status: "idle" }), true);
	assert.equal(canClose({ turn: 3, status: "done" }), true);
	assert.equal(canClose({ turn: 0, status: "idle" }), false);
	assert.equal(canClose({ turn: 2, status: "working" }), false);
	assert.equal(canClose({ turn: 2, status: "blocked" }), false);
	assert.equal(canClose({ status: "idle" }), false);
});

// --- One merged agent list (mergeAgentRows, displayedOrder) ---

test("a Pi terminal appears once in the merged list, not twice", () => {
	const agents = [{ address: "t1", status: "working" }, { address: "t2", status: "idle" }];
	const pi = piRows([term("t2", { "pi.session": "s" }, { argv: ["pi", "--model", "a/b"] })]);
	const merged = mergeAgentRows(agents, pi);
	assert.deepEqual(merged.map((e) => e.address), ["t1", "t2"]);
	assert.equal(merged.filter((e) => e.address === "t2").length, 1);
	assert.equal(merged[1].pi?.address, "t2");
	assert.equal(merged[1].agent?.status, "idle");
});

test("a non-Pi agent keeps its status and position in the merged list", () => {
	const agents = [
		{ address: "claude-1", status: "blocked" },
		{ address: "pi-1", status: "working" },
		{ address: "codex-1", status: "done" },
	];
	const pi = piRows([term("pi-1", { "pi.session": "s" })]);
	const merged = mergeAgentRows(agents, pi);
	assert.deepEqual(merged.map((e) => e.address), ["claude-1", "pi-1", "codex-1"]);
	const claude = merged[0];
	assert.equal(claude.pi, null);
	assert.equal(claude.agent.status, "blocked");
	assert.equal(merged[2].pi, null);
	assert.equal(merged[2].agent.status, "done");
});

test("a Pi run with no agent status is appended, so no run disappears", () => {
	const agents = [{ address: "t1", status: "idle" }];
	const pi = piRows([term("t9", { "pi.session": "s" })]);
	const merged = mergeAgentRows(agents, pi);
	assert.deepEqual(merged.map((e) => e.address), ["t1", "t9"]);
	assert.equal(merged[1].agent, null);
	assert.equal(merged[1].pi.address, "t9");
});

test("displayedOrder is the order of the merged list, with duplicates dropped", () => {
	const entries = [
		{ address: "b" },
		{ address: "a" },
		{ address: "b" },
		{ address: "c" },
	];
	assert.deepEqual(displayedOrder(entries), ["b", "a", "c"]);
	assert.deepEqual(displayedOrder(mergeAgentRows([{ address: "x" }, { address: "y" }], [])).map((x) => x), ["x", "y"]);
	assert.deepEqual(displayedOrder(null), []);
});

// --- Sub-agent trees, pins, sort tie-break, pruning (slice 1b) ---

test("subTree nests a child under its parent, not at the top level", () => {
	const terminals = [
		{ address: "p", parent: null, state: "live" },
		{ address: "c1", parent: "p", state: "live" },
		{ address: "c2", parent: "p", state: "live" },
		{ address: "g1", parent: "c1", state: "live" },
	];
	const tree = subTree(terminals, "p");
	assert.deepEqual(tree.map((s) => s.t.address), ["c1", "g1", "c2"]);
	assert.deepEqual(tree[0].lines, ["├"]);
	assert.deepEqual(tree[1].lines, ["│", "└"]);
	assert.deepEqual(tree[2].lines, ["└"]);
	// The parent is not its own child, and a top-level row is never listed as a child.
	assert.equal(subTree(terminals, "c2").length, 0);
});

test("subTree leaves out children that are not live", () => {
	const terminals = [
		{ address: "p", state: "live" },
		{ address: "gone", parent: "p", state: "exited" },
		{ address: "up", parent: "p", state: "live" },
	];
	assert.deepEqual(subTree(terminals, "p").map((s) => s.t.address), ["up"]);
});

test("subTree returns nothing for an agent with no children or no list", () => {
	assert.deepEqual(subTree([{ address: "a", state: "live" }], "a"), []);
	assert.deepEqual(subTree(undefined, "a"), []);
});

test("pinnedFirst puts pinned agents ahead, each group in its own order", () => {
	const list = [
		{ address: "a", pinned: false },
		{ address: "b", pinned: true },
		{ address: "c", pinned: false },
		{ address: "d", pinned: true },
	];
	assert.deepEqual(pinnedFirst(list).map((x) => x.address), ["b", "d", "a", "c"]);
	assert.deepEqual(pinnedFirst([]), []);
});

test("byUrgency sorts a higher rank first, then the more recent change", () => {
	const rank = { a: 1, b: 3, c: 1, d: 3 };
	const stamp = { a: 500, b: 100, c: 900, d: 200 };
	const sorted = ["a", "b", "c", "d"].sort(byUrgency((k) => rank[k], (k) => stamp[k]));
	assert.deepEqual(sorted, ["d", "b", "c", "a"]);
});

test("byUrgency puts an unseen row (stamp 0) last within its rank", () => {
	const rank = { seen: 2, unseen: 2 };
	const stamp = { seen: 50, unseen: 0 };
	const sorted = ["unseen", "seen"].sort(byUrgency((k) => rank[k], (k) => stamp[k]));
	assert.deepEqual(sorted, ["seen", "unseen"]);
});

test("pruneChanged removes addresses that are no longer listed and keeps present ones", () => {
	const changed = { t1: { s: "idle", at: 1 }, gone: { s: "working", at: 2 } };
	assert.deepEqual(pruneChanged(changed, ["t1", "t9"]), { t1: { s: "idle", at: 1 } });
	assert.deepEqual(pruneChanged(changed, []), {});
	assert.deepEqual(pruneChanged(undefined, ["t1"]), {});
});
