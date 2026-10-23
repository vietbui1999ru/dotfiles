// Absorb: a review batch from the pane, sent to the Pi session that left a
// pending review, starts a run from that review's base and retires the record.
// Every other input is refused as before.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import agentReview, { reviewBatchId } from "./index.ts";

const dirs: string[] = [];
const sessions: Array<() => Promise<unknown>> = [];
after(async () => {
	for (const close of sessions) await close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function makeRepo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-absorb-")));
	dirs.push(root);
	git(root, "init", "-q");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "test");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	writeFileSync(join(root, ".gitignore"), "/.pi/agent-review/\n");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "base");
	return root;
}

// One Pi session over `root`; `sessionId` is what ctx.sessionManager reports.
function start(root: string, sessionId: string) {
	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	const channels = new Map<string, Array<(data: unknown) => void>>();
	const ctx = {
		cwd: root, hasUI: true, mode: "tui",
		ui: { notify: () => {}, setStatus: () => {} },
		sessionManager: { getSessionId: () => sessionId },
	};
	const pi = {
		on: (name: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
		registerCommand: () => {},
		events: {
			on: (channel: string, h: (data: unknown) => void) => {
				channels.set(channel, [...(channels.get(channel) ?? []), h]);
				return () => {};
			},
			emit: (channel: string, data: unknown) => channels.get(channel)?.forEach((h) => h(data)),
		},
		sendUserMessage: () => {},
	};
	agentReview(pi as never);
	const emit = async (name: string, payload: Record<string, unknown> = {}) => {
		let last: unknown;
		for (const h of handlers.get(name) ?? []) last = await h({ type: name, ...payload }, ctx);
		return last;
	};
	sessions.push(() => emit("session_shutdown"));
	const settle = async () => {
		await emit("agent_settled");
		pi.events.emit("post-run-verifier:settled", {});
	};
	return { emit, settle };
}

const pendingDir = (root: string) => join(root, ".pi", "agent-review", "pending");
const records = (root: string) =>
	(existsSync(pendingDir(root)) ? readdirSync(pendingDir(root)) : [])
		.filter((name) => name.endsWith(".json"))
		.map((name) => JSON.parse(readFileSync(join(pendingDir(root), name), "utf8")));

async function waitFor(check: () => boolean) {
	for (let i = 0; i < 100; i++) {
		if (check()) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error("condition never held");
}

// A run in `session` that writes `file`, ending with its pending record on disk.
async function run(root: string, session: ReturnType<typeof start>, text: string, file: string) {
	const answer = await session.emit("input", { text, source: "interactive" });
	await session.emit("agent_start");
	writeFileSync(join(root, file), `${text}\n`);
	await session.settle();
	return answer;
}

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";

test("reviewBatchId reads the marker from the first line only", () => {
	assert.equal(reviewBatchId(`[review-batch ${ID}]\nnotes`), ID);
	assert.equal(reviewBatchId(`notes\n[review-batch ${ID}]`), undefined);
	assert.equal(reviewBatchId("[review-batch nope]"), undefined);
	assert.equal(reviewBatchId(""), undefined);
});

test("a new pending record names the Pi session that wrote it", async () => {
	const root = makeRepo();
	await run(root, start(root, "sess-1"), "work", "tracked.txt");
	await waitFor(() => records(root).length === 1);
	assert.equal(records(root)[0].session, "sess-1");
});
