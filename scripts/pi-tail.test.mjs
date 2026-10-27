// Run: node --test scripts/pi-tail.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { closeSync, constants, mkdtempSync, openSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { foldChunk, relayInput, render, splitComplete, watchRunner } from "./pi-tail.mjs";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// pueue kill sends SIGKILL, so pi-view cannot report; the viewer reports for it.
test("a runner that dies while herdr still shows working is reported blocked", async () => {
	let alive = 2;
	const reports = [];
	await watchRunner({
		pid: 123,
		pane: "w1:p1",
		intervalMs: 1,
		isAlive: () => alive-- > 0,
		paneStatus: async () => "working",
		report: async (pane) => reports.push(pane),
	});
	assert.deepEqual(reports, ["w1:p1"]);
});

test("a runner that already reported its own end is left alone", async () => {
	for (const status of ["idle", "blocked"]) {
		const reports = [];
		await watchRunner({
			pid: 123,
			pane: "w1:p1",
			intervalMs: 1,
			isAlive: () => false,
			paneStatus: async () => status,
			report: async (pane) => reports.push(pane),
		});
		assert.deepEqual(reports, [], `reported over ${status}`);
	}
});

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

test("relays pane input to a session FIFO and stops after it disappears", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-tail-input-"));
	const fifo = join(dir, "pueue-a.in");
	execFileSync("mkfifo", ["-m", "600", fifo]);
	const reader = openSync(fifo, constants.O_RDONLY | constants.O_NONBLOCK);
	const input = new PassThrough();
	const messages = [];
	const relay = relayInput(input, fifo, (line) => messages.push(line));
	try {
		input.write("steer this\n");
		let received = "";
		for (let attempt = 0; attempt < 100 && received.length === 0; attempt++) {
			await sleep(20);
			const buffer = Buffer.alloc(64);
			try {
				const count = readSync(reader, buffer, 0, buffer.length, null);
				if (count > 0) received = buffer.subarray(0, count).toString();
			} catch (error) {
				if (error.code !== "EAGAIN") throw error;
			}
		}
		assert.equal(received, "steer this\n");

		rmSync(fifo);
		input.write("too late\n");
		for (let attempt = 0; attempt < 100 && messages.length === 0; attempt++) await sleep(20);
		assert.deepEqual(messages, ["session ended"]);
	} finally {
		relay.close();
		input.end();
		closeSync(reader);
		rmSync(dir, { recursive: true, force: true });
	}
});
