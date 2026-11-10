// Tests for the leader mod's pure logic (herdr-app mods/leader/logic.js).
// Run: node --test scripts/leader-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../herdr-app/.config/herdr-app/mods/leader/logic.js";

const press = (key, shift = false) => ({ key, modifiers: { shift, control: false, alt: false, platform: false, function: false } });

test("every map key resolves to its own entry", () => {
	for (const [key, entry] of Object.entries(L.LEADER_MAP)) {
		assert.equal(L.resolveKey(press(key, false)) ?? L.resolveKey(press(key, true)), entry, `key ${key}`);
		assert.ok(entry.label, `label for ${key}`);
		assert.ok(L.GROUPS.includes(entry.group), `group for ${key}`);
	}
});

test("a shifted letter resolves in both forms: the capital key, or the lowercase key with shift", () => {
	for (const letter of ["h", "j", "k", "l"]) {
		const upper = letter.toUpperCase();
		assert.equal(L.resolveKey(press(upper)), L.LEADER_MAP[upper]);
		assert.equal(L.resolveKey(press(letter, true)), L.LEADER_MAP[upper]);
	}
	assert.equal(L.resolveKey(press("G")), L.LEADER_MAP.G);
	assert.equal(L.resolveKey(press("g", true)), L.LEADER_MAP.G);
	assert.equal(L.resolveKey(press("R")), L.LEADER_MAP.R);
	assert.equal(L.resolveKey(press("r", true)), L.LEADER_MAP.R);
});

test("a shifted lowercase key that is not a letter in the map still resolves to nothing", () => {
	assert.equal(L.resolveKey(press("x", true)), null);
	assert.equal(L.resolveKey(press("q", true)), null);
});

test("h and H are different commands: pane focus and pane swap", () => {
	assert.equal(L.resolveKey(press("h")).command, "pane.go");
	assert.deepEqual(L.resolveKey(press("h")).args, { direction: "left" });
	assert.equal(L.resolveKey(press("H")).command, "pane.swap");
	assert.deepEqual(L.resolveKey(press("H")).args, { direction: "left" });
});

test("unknown keys resolve to null", () => {
	for (const key of ["q", "F1", "escape", "Q", "*", "", "ctrl"]) {
		assert.equal(L.resolveKey(press(key)), null, `key ${JSON.stringify(key)}`);
	}
	assert.equal(L.resolveKey(null), null);
	assert.equal(L.resolveKey({}), null);
});

test("Tab, however the key event spells it, is the other-panel key", () => {
	assert.equal(L.resolveKey(press("Tab")), L.LEADER_MAP.Tab);
	assert.equal(L.resolveKey(press("tab")), L.LEADER_MAP.Tab);
});

test("numbers select tabs by index", () => {
	for (let i = 1; i <= 9; i++) {
		assert.equal(L.resolveKey(press(String(i))).args.index, i);
	}
});

test("the required keys are all in the map", () => {
	for (const key of ["h", "j", "k", "l", "H", "J", "K", "L", "n", "p", "1", "9", "]", "[", "s", "v", "x", "z", "w", "a", "o", "m", "g", "G", "r", "R", "e", "c", "Tab", "b"]) {
		assert.ok(L.resolveKey(press(key)), `key ${key}`);
	}
});

test("nextSize steps and clamps at both ends", () => {
	assert.equal(L.nextSize(268, 40, 44, 480), 308);
	assert.equal(L.nextSize(268, -40, 44, 480), 228);
	assert.equal(L.nextSize(470, 40, 44, 480), 480, "clamped at the max");
	assert.equal(L.nextSize(50, -40, 44, 480), 44, "clamped at the min");
	assert.equal(L.nextSize(900, 40, 280, 900), 900);
	assert.equal(L.nextSize(280, -40, 280, 900), 280);
});

test("nextSize keeps the current size on a non-finite input", () => {
	assert.equal(L.nextSize(NaN, 40, 44, 480), 84);
	assert.equal(L.nextSize(268, NaN, 44, 480), 268);
});

test("resizeTarget: h/l move the sidebar, H/L the panel, anything else nothing", () => {
	assert.deepEqual(L.resizeTarget("h"), { node: L.SIDEBAR, delta: -40 });
	assert.deepEqual(L.resizeTarget("l"), { node: L.SIDEBAR, delta: 40 });
	assert.deepEqual(L.resizeTarget("H"), { node: L.PANEL, delta: 40 });
	assert.deepEqual(L.resizeTarget("L"), { node: L.PANEL, delta: -40 });
	assert.equal(L.resizeTarget("j"), null);
});

test("panelAction: opening a closed panel shows its child", () => {
	assert.deepEqual(L.panelAction({ open: false, active: null }, "files"), [
		{ command: "layout.select", args: { stack: "panel-body", child: "files" } },
		{ command: "layout.show", args: { id: "panel" } },
	]);
});

test("panelAction: the same child while open hides the panel", () => {
	assert.deepEqual(L.panelAction({ open: true, active: "changes" }, "changes"), [
		{ command: "layout.hide", args: { id: "panel" } },
	]);
});

test("panelAction: the other child while open switches without hiding", () => {
	assert.deepEqual(L.panelAction({ open: true, active: "files" }, "changes"), [
		{ command: "layout.select", args: { stack: "panel-body", child: "changes" } },
	]);
});

test("panelAction: Tab switches to the other child when open, does nothing when closed", () => {
	assert.deepEqual(L.panelAction({ open: true, active: "files" }, "other"), [
		{ command: "layout.select", args: { stack: "panel-body", child: "changes" } },
	]);
	assert.deepEqual(L.panelAction({ open: true, active: "changes" }, "other"), [
		{ command: "layout.select", args: { stack: "panel-body", child: "files" } },
	]);
	assert.deepEqual(L.panelAction({ open: false, active: "files" }, "other"), []);
});

test("panelState reads the panel's shown flag and active child from a layout tree", () => {
	const tree = { id: "root", children: [{ id: "panel", hidden: false, children: [{ id: "panel-body", active: "changes" }] }] };
	assert.deepEqual(L.panelState(tree), { open: true, active: "changes" });
	assert.deepEqual(L.panelState({ id: "root", children: [{ id: "panel", hidden: true, children: [{ id: "panel-body", active: "files" }] }] }), { open: false, active: "files" });
	assert.deepEqual(L.panelState({ id: "root", children: [] }), { open: false, active: null });
	assert.deepEqual(L.panelState(null), { open: false, active: null });
});

test("sizeOf reads a node's px, and null when the node has none", () => {
	const tree = { id: "root", children: [{ id: "sidebar", size: { px: 268 } }, { id: "work", size: { weight: 1 } }] };
	assert.equal(L.sizeOf(tree, "sidebar"), 268);
	assert.equal(L.sizeOf(tree, "work"), null);
	assert.equal(L.sizeOf(tree, "missing"), null);
});

test("isHerdrPi is true only for the herdr-pi layout", () => {
	assert.equal(L.isHerdrPi("herdr-pi"), true);
	assert.equal(L.isHerdrPi("main"), false);
	assert.equal(L.isHerdrPi(""), false);
});

test("rowsFor returns one group's entries in map order", () => {
	const panels = L.rowsFor("Panels").map((e) => e.key);
	assert.deepEqual(panels, ["e", "c", "Tab", "b"]);
});
