// Run: node --test scripts/pi-live.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { GRACE_SECONDS, buildPiInvocation, nextAction } from "./pi-live.mjs";

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
