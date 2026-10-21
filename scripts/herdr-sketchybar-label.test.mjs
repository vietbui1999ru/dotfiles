// Run: node --test scripts/herdr-sketchybar-label.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderState, shortNext } from "./herdr-sketchybar-label.mjs";

test("counts blocked panes and the total", () => {
	const state = renderState(["idle", "working", "blocked", "idle", "blocked"], 2);
	assert.deepEqual(state, { blocked: 2, total: 5, totalStatus: "working", pi: 2, next: "" });
});

test("total color follows herdr urgency: working, done, idle, unknown", () => {
	assert.equal(renderState(["idle", "done"]).totalStatus, "done");
	assert.equal(renderState(["idle"]).totalStatus, "idle");
	assert.equal(renderState(["weird"]).totalStatus, "unknown");
	assert.equal(renderState(["blocked"]).totalStatus, "");
});

test("no Claude panes gives zeros", () => {
	assert.deepEqual(renderState([]), { blocked: 0, total: 0, totalStatus: "", pi: 0, next: "" });
});

test("short NEXT keeps the tag and caps at five words", () => {
	assert.equal(
		shortNext("NEXT: choose the bar label (icon only or icon plus worst %), a keybinding, and whether Pi or I build it [you]"),
		"choose the bar label, a… [you]",
	);
	assert.equal(shortNext("  NEXT: review PR [you]"), "review PR [you]");
});

test("short NEXT drops TUI junk drawn beside the line", () => {
	assert.equal(shortNext("NEXT: rebase PR 120, then recheck   │    widget      2d"), "rebase PR 120, then recheck");
	assert.equal(shortNext("NEXT:    │ x"), "");
});

test("renderState passes NEXT through shortNext", () => {
	assert.equal(renderState([], 0, "NEXT: merge PR 162 [you]").next, "merge PR 162 [you]");
});
