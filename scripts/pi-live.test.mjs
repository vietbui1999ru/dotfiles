// Run: node --test scripts/pi-live.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { GRACE_SECONDS, buildPiInvocation, nextAction } from "./pi-live.mjs";

// A stand-in Pi: answers the prompt with a run that settles, then exits on its own a
// second later. By then the driver's FIFO read has been idle and pending, which is
// the state the live grace-period close found it in.
const FAKE_PI = `#!/usr/bin/env node
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
	if (JSON.parse(line).type !== "prompt") return;
	process.stdout.write('{"type":"agent_start"}\\n{"type":"agent_settled"}\\n');
	setTimeout(() => process.exit(0), 1000);
});
`;

// A stand-in Pi that stays up until the driver closes its stdin.
const FAKE_PI_UNTIL_CLOSED = FAKE_PI.replace("setTimeout(() => process.exit(0), 1000);", "").concat('rl.on("close", () => process.exit(0));\n');

// Start the driver on a fake Pi; returns its process and FIFO path once the FIFO exists.
async function startDriver(fakeSource) {
	const dir = mkdtempSync(join(tmpdir(), "pi-live-exit-"));
	const fake = join(dir, "fake-pi.mjs");
	writeFileSync(fake, fakeSource);
	chmodSync(fake, 0o755);
	const driver = spawn(process.execPath, [new URL("./pi-live.mjs", import.meta.url).pathname, "--", fake, "--session-id", "pueue-exit-test", "-p", "hi"], {
		env: { ...process.env, TMPDIR: dir },
		stdio: "ignore",
	});
	const fifo = join(dir, "pi-view", "pueue-exit-test.in");
	for (let i = 0; i < 50 && !existsSync(fifo); i += 1) await new Promise((r) => setTimeout(r, 100));
	assert.ok(existsSync(fifo), "the driver never created its FIFO");
	return { driver, fifo };
}

async function exitCode(driver) {
	const code = await Promise.race([
		new Promise((resolve) => driver.on("exit", (c) => resolve(c))),
		new Promise((resolve) => setTimeout(() => resolve("still running after 5 s"), 5000)),
	]);
	if (code === "still running after 5 s") driver.kill("SIGKILL");
	return code;
}

test("the driver process exits once Pi exits, even with a FIFO read pending", async () => {
	const { driver } = await startDriver(FAKE_PI);
	assert.equal(await exitCode(driver), 0);
});

test("a line written to the FIFO reaches the driver: /done ends the session", async () => {
	const { driver, fifo } = await startDriver(FAKE_PI_UNTIL_CLOSED);
	await new Promise((r) => setTimeout(r, 500));
	writeFileSync(fifo, "/done\n");
	assert.equal(await exitCode(driver), 0);
});

const idle = { phase: "idle", graceActive: false };
const working = { phase: "working", graceActive: false };

test("rewrites the dispatch into an RPC invocation without changing anything else", () => {
	assert.deepEqual(
		buildPiInvocation(["pi", "--model", "opencode-go/x:high", "--session-id", "pueue-a", "-p", "do the thing"]),
		{
			command: "pi",
			args: ["--mode", "rpc", "--model", "opencode-go/x:high", "--session-id", "pueue-a"],
			prompt: "do the thing",
		},
	);
	assert.deepEqual(buildPiInvocation(["pi", "--print", "hi"]), {
		command: "pi",
		args: ["--mode", "rpc"],
		prompt: "hi",
	});
});

test("steers while working and prompts while idle", () => {
	assert.deepEqual(nextAction(working, { type: "input", line: "change direction" }), {
		state: working,
		commands: [{ type: "steer", message: "change direction" }],
	});
	assert.deepEqual(nextAction(idle, { type: "input", line: "keep going" }), {
		state: idle,
		commands: [{ type: "prompt", message: "keep going" }],
	});
});

test("/abort aborts and keeps the session, /done closes it", () => {
	const abort = nextAction(working, { type: "input", line: "/abort" });
	assert.deepEqual(abort.commands, [{ type: "abort" }]);
	assert.equal(abort.close, undefined);

	const done = nextAction(working, { type: "input", line: "/done" });
	assert.deepEqual(done.commands, []);
	assert.equal(done.close, true);
});

test("settle starts the grace wait, and agent_start or input cancels it", () => {
	const settled = nextAction(working, { type: "agent_settled" });
	assert.deepEqual(settled.state, { phase: "idle", graceActive: true });
	assert.equal(GRACE_SECONDS, 120);

	const started = nextAction(settled.state, { type: "agent_start" });
	assert.deepEqual(started.state, { phase: "working", graceActive: false });

	const typed = nextAction({ phase: "idle", graceActive: true }, { type: "input", line: "one more" });
	assert.equal(typed.state.graceActive, false);
	assert.deepEqual(typed.commands, [{ type: "prompt", message: "one more" }]);
});

test("the grace wait closes the session only while it is active", () => {
	const expired = nextAction({ phase: "idle", graceActive: true }, { type: "grace_expired" });
	assert.deepEqual(expired.state, { phase: "idle", graceActive: false });
	assert.equal(expired.close, true);
	assert.equal(nextAction({ phase: "idle", graceActive: false }, { type: "grace_expired" }).close, undefined);
});

test("a dialog is cancelled and noted so Pi never waits for an answer", () => {
	const action = nextAction(working, {
		type: "extension_ui_request",
		request: { type: "extension_ui_request", id: "req-1", method: "select", title: "Pick one" },
	});
	assert.deepEqual(action.commands, [
		{ type: "extension_ui_response", id: "req-1", cancelled: true },
		{ type: "note", text: "cancelled select: Pick one" },
	]);
});

test("a notify becomes a note, and status widgets are ignored", () => {
	const notify = nextAction(working, {
		type: "extension_ui_request",
		request: { type: "extension_ui_request", id: "req-2", method: "notify", message: "Review pending — /review skip" },
	});
	assert.deepEqual(notify.commands, [{ type: "note", text: "Review pending — /review skip" }]);
	assert.deepEqual(
		nextAction(working, {
			type: "extension_ui_request",
			request: { type: "extension_ui_request", id: "req-3", method: "setStatus", statusKey: "review" },
		}).commands,
		[],
	);
});
