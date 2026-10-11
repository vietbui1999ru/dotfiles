// Review names: a short key per pending review, taken from the branch, so a
// person can type `/review skip pi-handoff` instead of a 36-character run id.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import agentReview, { resolveReview, reviewName } from "./index.ts";

const dirs: string[] = [];
const closers: Array<() => Promise<unknown>> = [];
after(async () => {
	for (const close of closers) await close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

test("reviewName takes the branch's last segment and avoids names in use", () => {
	assert.equal(reviewName("feat/session-band-pi-handoff", []), "session-band-pi-handoff");
	assert.equal(reviewName("main", []), "main");
	assert.equal(reviewName("Fix/Odd Name!", []), "odd-name");
	assert.equal(reviewName("HEAD", []), "review");
	assert.equal(reviewName("feat/x", ["x", "x-2"]), "x-3");
});

const a = { runId: "535eb0c6-7d15-4dc6-88d8-66332e10161f", name: "pi-handoff" };
const b = { runId: "535e9999-7d15-4dc6-88d8-66332e10161f", name: "m7a" };
const old = { runId: "f9a9f119-ce95-4171-9eed-5669a0a54e22" }; // written before names existed

test("resolveReview matches a name, a full id, or a unique id prefix", () => {
	assert.deepEqual(resolveReview([a, b, old], "pi-handoff"), [a]);
	assert.deepEqual(resolveReview([a, b, old], b.runId), [b]);
	assert.deepEqual(resolveReview([a, b, old], "F9A9"), [old]);
	assert.deepEqual(resolveReview([a, b, old], "535e"), [a, b], "ambiguous prefix returns every match");
	assert.deepEqual(resolveReview([a, b, old], "535"), [], "prefixes shorter than 4 never match");
	assert.deepEqual(resolveReview([a, b, old], ""), []);
});

function start(root: string) {
	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	const commands = new Map<string, { handler: (args: string, c: unknown) => Promise<void>; getArgumentCompletions?: (p: string) => unknown }>();
	const notices: string[] = [];
	const settled: Array<(data: unknown) => void> = [];
	const ctx = { cwd: root, hasUI: true, mode: "tui", ui: { notify: (m: string) => notices.push(m), setStatus: () => {} } };
	agentReview({
		on: (name: string, h: (e: unknown, c: unknown) => unknown) => handlers.set(name, [...(handlers.get(name) ?? []), h]),
		registerCommand: (name: string, options: never) => commands.set(name, options),
		events: { on: (_c: string, h: (d: unknown) => void) => (settled.push(h), () => {}), emit: () => {} },
		sendUserMessage: () => {},
	} as never);
	const emit = async (name: string, payload: Record<string, unknown> = {}) => {
		let result: unknown;
		for (const h of handlers.get(name) ?? []) result = (await h({ type: name, ...payload }, ctx)) ?? result;
		return result;
	};
	closers.push(() => emit("session_shutdown"));
	const settle = async () => { await emit("agent_settled"); settled.forEach((h) => h({})); };
	return { emit, settle, notices, review: commands.get("review")! };
}

test("a pending review is named after the branch and can be skipped by that name", async () => {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-names-")));
	dirs.push(root);
	const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
	git("init", "-q");
	git("checkout", "-qb", "feat/demo-work");
	git("-c", "user.email=t@e", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "base");
	const { emit, settle, notices, review } = start(root);
	await emit("session_start");
	await emit("input", { text: "do the work", source: "interactive" });
	await emit("agent_start");
	writeFileSync(join(root, "tracked.txt"), "agent edit\n");
	await settle();
	const dir = join(root, ".pi", "agent-review", "pending");
	const json = () => (existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")) : []);
	for (let i = 0; i < 100 && json().length === 0; i++) await new Promise((r) => setTimeout(r, 50));
	const [file] = json();
	assert.equal(JSON.parse(readFileSync(join(dir, file), "utf8")).name, "demo-work");
	assert.deepEqual(await emit("input", { text: "again", source: "interactive" }), { action: "handled" });
	assert.ok(notices.some((n) => n.includes("/review skip demo-work")), JSON.stringify(notices));
	assert.deepEqual(await review.getArgumentCompletions?.("skip de"), [
		{ value: "skip demo-work", label: "demo-work", description: file.slice(0, 8) },
	]);
	await review.handler("skip demo-work", { cwd: root, ui: { notify: () => {} } });
	assert.ok(readdirSync(join(root, ".pi", "agent-review", "decisions")).includes(file));
});
