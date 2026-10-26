// Run: node --test scripts/pi-tail.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { foldChunk, render, splitComplete } from "./pi-tail.mjs";

test("renders text, tool, and error entries as the Pi pane does", () => {
	assert.deepEqual(render({ kind: "text", text: "planning the change" }, false), ["planning the change"]);
	assert.deepEqual(render({ kind: "text", text: "x".repeat(300) }, false), ["x".repeat(280)]);
	assert.deepEqual(render({ kind: "tool", text: "bash ls -la" }, false), ["bash ls -la"]);
	assert.deepEqual(render({ kind: "error", text: "boom" }, false), ["ERROR boom"]);
});

test("thinking is hidden by default and shown with its prefix when asked for", () => {
	assert.deepEqual(render({ kind: "thinking", text: "weighing options" }, false), []);
	assert.deepEqual(render({ kind: "thinking", text: "weighing options" }, true), ["  · weighing options"]);
	assert.deepEqual(render({ kind: "thinking", text: "" }, true), ["  · thinking…"]);
});

test("output renders one indented arrow line per line", () => {
	assert.deepEqual(render({ kind: "output", text: "a\nb" }, false), ["  ↳ a", "  ↳ b"]);
});

test("splitComplete holds back the unterminated line", () => {
	assert.deepEqual(splitComplete('{"a":1}\n{"b":'), { lines: ['{"a":1}'], rest: '{"b":' });
	assert.deepEqual(splitComplete("no newline yet"), { lines: [], rest: "no newline yet" });
	assert.deepEqual(splitComplete("one\ntwo\n"), { lines: ["one", "two"], rest: "" });
	assert.deepEqual(splitComplete("a\n\nb\n"), { lines: ["a", "b"], rest: "" });
});

test("foldChunk returns only the entries of the lines it was given", () => {
	const line = (text) => JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "text", text }] } });
	assert.deepEqual(foldChunk([line("first")]).map((entry) => entry.text), ["first"]);
	assert.deepEqual(foldChunk([line("second")]).map((entry) => entry.text), ["second"]);
	assert.deepEqual(foldChunk([]), []);
});
