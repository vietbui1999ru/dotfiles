// A decision written while Pi was down is processed at the next session_start.
// In print mode (`pi -p`) its follow-up must wait for the prompt's run, or the
// follow-up starts a turn first and the prompt is rejected as "already processing".
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import agentReview from "./index.ts";

const dirs: string[] = [];
after(() => {
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function repo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-startup-")));
	dirs.push(root);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
	git("init", "-q");
	git("config", "user.email", "t@e");
	git("config", "user.name", "t");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	git("add", "-A");
	git("commit", "-qm", "base");
	return root;
}

function start(root: string, hasUI: boolean) {
	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	const settled: Array<(data: unknown) => void> = [];
	const sent: string[] = [];
	const ctx = { cwd: root, hasUI, mode: hasUI ? "tui" : "print", ui: { notify: () => {}, setStatus: () => {} } };
	agentReview({
		on: (name: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
		registerCommand: () => {},
		events: { on: (_c: string, h: (d: unknown) => void) => (settled.push(h), () => {}), emit: () => {} },
		sendUserMessage: (text: string) => sent.push(text),
	} as never);
	const emit = async (name: string, payload: Record<string, unknown> = {}) => {
		let result: unknown;
		for (const h of handlers.get(name) ?? []) result = (await h({ type: name, ...payload }, ctx)) ?? result;
		return result;
	};
	const settle = async () => {
		await emit("agent_settled");
		settled.forEach((h) => h({}));
	};
	return { emit, settle, sent };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const pendingDir = (root: string) => join(root, ".pi", "agent-review", "pending");
const pendingJson = (root: string) =>
	existsSync(pendingDir(root)) ? readdirSync(pendingDir(root)).filter((n) => n.endsWith(".json")) : [];

// Leaves one pending review whose decision (accepted as-is, with a note) needs a follow-up.
async function reviewedRun(root: string): Promise<string> {
	const first = start(root, true);
	await first.emit("session_start");
	await first.emit("input", { text: "do the work", source: "interactive" });
	await first.emit("agent_start");
	writeFileSync(join(root, "tracked.txt"), "agent edit\n");
	await first.settle();
	for (let i = 0; i < 100 && pendingJson(root).length === 0; i++) await sleep(50);
	const [file] = pendingJson(root);
	const record = JSON.parse(readFileSync(join(pendingDir(root), file), "utf8"));
	await first.emit("session_shutdown");
	const dir = join(root, ".pi", "agent-review", "decisions");
	mkdirSync(dir, { recursive: true });
	const decision = { runId: record.runId, endTree: record.endTree, finalTree: record.endTree, files: [], notes: [{ file: "tracked.txt", line: 1, note: "keep this" }], patch: "" };
	writeFileSync(join(dir, `${record.runId}.json.tmp`), JSON.stringify(decision));
	renameSync(join(dir, `${record.runId}.json.tmp`), join(dir, `${record.runId}.json`));
	return record.runId;
}

test("print mode holds the startup follow-up until the prompt's run starts", async () => {
	const root = repo();
	const runId = await reviewedRun(root);
	const next = start(root, false);
	await next.emit("session_start");
	await sleep(200);
	assert.deepEqual(next.sent, [], "no turn may start before the -p prompt");
	assert.deepEqual(pendingJson(root), [], "the decision is still consumed at startup");
	assert.deepEqual(await next.emit("input", { text: "the -p prompt", source: "interactive" }), { action: "continue" });
	await next.emit("agent_start");
	assert.equal(next.sent.length, 1);
	assert.ok(next.sent[0].includes(runId));
	await next.emit("session_shutdown");
});

test("interactive mode still sends the startup follow-up immediately", async () => {
	const root = repo();
	await reviewedRun(root);
	const next = start(root, true);
	await next.emit("session_start");
	assert.equal(next.sent.length, 1);
	await next.emit("session_shutdown");
});
