// Run: node --test scripts/herdr-sketchybar-label.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { CLAUDE_ICON, NEXT_ICON, PI_ICON, renderLabel } from "./herdr-sketchybar-label.mjs";

test("counts Claude panes per status, in fixed order", () => {
	const label = renderLabel(["idle", "working", "blocked", "idle", "working"]);
	assert.equal(label, `${CLAUDE_ICON} 2● 1! 2○`);
});

test("omits zero counts; done counts as idle; odd statuses as unknown", () => {
	assert.equal(renderLabel(["done", "idle"]), `${CLAUDE_ICON} 2○`);
	assert.equal(renderLabel(["weird"]), `${CLAUDE_ICON} 1?`);
});

test("no Claude panes shows a dash", () => {
	assert.equal(renderLabel([]), `${CLAUDE_ICON} –`);
});

test("Pi segment only while pueue tasks run", () => {
	assert.equal(renderLabel(["idle"], 0), `${CLAUDE_ICON} 1○`);
	assert.equal(renderLabel(["idle"], 2), `${CLAUDE_ICON} 1○ │ ${PI_ICON} 2●`);
});

test("NEXT line is appended without its prefix", () => {
	assert.equal(
		renderLabel(["idle"], 1, "  NEXT: review PR [you]"),
		`${CLAUDE_ICON} 1○ │ ${PI_ICON} 1● │ ${NEXT_ICON} review PR [you]`,
	);
});

test("NEXT drops TUI junk drawn beside the line", () => {
	assert.equal(
		renderLabel([], 0, "NEXT: rebase PR 120, then recheck   │    widget      2d"),
		`${CLAUDE_ICON} – │ ${NEXT_ICON} rebase PR 120, then recheck`,
	);
	assert.equal(renderLabel([], 0, "NEXT:    │ x"), `${CLAUDE_ICON} –`);
});
