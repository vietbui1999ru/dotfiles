// Absorb: a review batch from the pane, sent to the Pi session that left a
// pending review, starts a run from that review's base and retires the record.
// Every other input is refused as before.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
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

const batch = (text: string) => `[review-batch ${ID}]\n${text}`;
const recordFile = (root: string, runId: string) => join(pendingDir(root), `${runId}.json`);
const refsOf = (root: string, runId: string) => git(root, "for-each-ref", `refs/agent-review/${runId}/`).trim();
const edit = (root: string, runId: string, change: (r: Record<string, unknown>) => void) => {
	const r = JSON.parse(readFileSync(recordFile(root, runId), "utf8"));
	change(r);
	writeFileSync(recordFile(root, runId), JSON.stringify(r));
};

// Run A in `sessionId`, then return it with its session handle.
async function firstRun(root: string, sessionId = "s1") {
	const session = start(root, sessionId);
	await run(root, session, "work", "a.txt");
	await waitFor(() => records(root).length === 1);
	return { session, a: records(root)[0] };
}

test("a review batch from the same session absorbs the pending run", async () => {
	const root = makeRepo();
	const { session, a } = await firstRun(root);
	assert.deepEqual(await run(root, session, batch("fix it"), "b.txt"), { action: "continue" });
	await waitFor(() => records(root).length === 1 && records(root)[0].runId !== a.runId);
	const [b] = records(root);
	assert.equal(b.base, a.base);
	assert.equal(b.baseTree, a.baseTree);
	assert.deepEqual(b.files.map((f: { file: string }) => f.file).sort(), ["a.txt", "b.txt"]);
	assert.equal(refsOf(root, a.runId), "");
	assert.equal(b.session, "s1");
});

test("plain input is still refused while a review is pending", async () => {
	const root = makeRepo();
	const { session, a } = await firstRun(root);
	assert.deepEqual(await session.emit("input", { text: "hello", source: "interactive" }), { action: "handled" });
	assert.deepEqual(records(root), [a]);
});

test("a batch from another session is refused", async () => {
	const root = makeRepo();
	const { a } = await firstRun(root);
	const other = start(root, "s2");
	assert.deepEqual(await other.emit("input", { text: batch("fix"), source: "interactive" }), { action: "handled" });
	assert.deepEqual(records(root), [a]);
});

for (const [label, change] of [
	["tampered", (r: Record<string, unknown>) => { r.tamper = true; }],
	["errored", (r: Record<string, unknown>) => { r.error = "x"; }],
	["session-less", (r: Record<string, unknown>) => { delete r.session; }],
] as const) {
	test(`a ${label} record is never absorbed`, async () => {
		const root = makeRepo();
		const { session, a } = await firstRun(root);
		edit(root, a.runId, change);
		const before = readFileSync(recordFile(root, a.runId), "utf8");
		assert.deepEqual(await session.emit("input", { text: batch("fix"), source: "interactive" }), { action: "handled" });
		assert.equal(readFileSync(recordFile(root, a.runId), "utf8"), before);
	});
}

test("a record mid-claim (being approved) is never absorbed", async () => {
	const root = makeRepo();
	const { session, a } = await firstRun(root);
	const claim = join(pendingDir(root), `${a.runId}.processing`);
	renameSync(recordFile(root, a.runId), claim);
	assert.deepEqual(await session.emit("input", { text: batch("fix"), source: "interactive" }), { action: "handled" });
	assert.ok(existsSync(claim));
	assert.notEqual(refsOf(root, a.runId), "");
});

test("no session id refuses", async () => {
	const root = makeRepo();
	const { session } = await firstRun(root, "");
	assert.deepEqual(await session.emit("input", { text: batch("fix"), source: "interactive" }), { action: "handled" });
});

test("two records from one session absorb from the oldest base", async () => {
	const root = makeRepo();
	const { session, a } = await firstRun(root);
	const second = { ...a, runId: "1b4e28ba-2fa1-41d2-883f-0016d3cca427", base: a.end, baseTree: a.endTree, startedAt: "2999-01-01T00:00:00.000Z" };
	writeFileSync(recordFile(root, second.runId), JSON.stringify(second));
	await run(root, session, batch("fix"), "b.txt");
	await waitFor(() => records(root).length === 1 && ![a.runId, second.runId].includes(records(root)[0].runId));
	assert.equal(records(root)[0].base, a.base);
});

test("a leftover record after an interrupted absorb is refused for plain input", async () => {
	const root = makeRepo();
	const { session, a } = await firstRun(root);
	await run(root, session, batch("fix"), "b.txt");
	await waitFor(() => records(root).length === 1 && records(root)[0].runId !== a.runId);
	writeFileSync(recordFile(root, a.runId), JSON.stringify(a));
	assert.deepEqual(await session.emit("input", { text: "hello", source: "interactive" }), { action: "handled" });
	assert.deepEqual(JSON.parse(readFileSync(recordFile(root, a.runId), "utf8")), a);
});
