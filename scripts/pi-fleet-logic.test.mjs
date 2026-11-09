// Run: node --test scripts/pi-fleet-logic.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import {
	duration,
	modelFrom,
	nextAddress,
	piRows,
	planSync,
	spawnArgs,
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
