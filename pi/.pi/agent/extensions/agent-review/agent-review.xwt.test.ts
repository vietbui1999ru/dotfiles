// Cross-worktree review discovery and actions (SPEC: agent-review cross-worktree, Phase 1).
// Real repos and real `git worktree add`; the confirm dialog is replaced only by
// loading the CLI as a module, as agent-review.approve.test.ts does.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { after } from "node:test";
import agentReview from "./index.ts";

const cli = join(dirname(new URL(import.meta.url).pathname), "../../../../../scripts/agent-review");
const dirs: string[] = [];
const sessions: Array<() => Promise<unknown>> = [];
after(async () => {
	for (const close of sessions) await close();
	for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
const tmp = (prefix: string) => {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
	dirs.push(dir);
	return dir;
};

function makeRepo(): string {
	const root = tmp("agent-review-xwt-");
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "test");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	writeFileSync(join(root, ".gitignore"), "/.pi/agent-review/\n");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "base");
	git(root, "update-ref", "refs/remotes/origin/main", "HEAD"); // "main" as last fetched
	return root;
}

function addWorktree(root: string, branch: string): string {
	const path = join(tmp("agent-review-wt-"), branch);
	git(root, "worktree", "add", "-q", "-b", branch, path);
	return path;
}

function start(root: string) {
	const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
	const channels = new Map<string, Array<(data: unknown) => void>>();
	const sent: string[] = [];
	const ctx = { cwd: root, hasUI: true, mode: "tui", ui: { notify: () => {}, setStatus: () => {} } };
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
		sendUserMessage: (text: string) => sent.push(text),
	};
	agentReview(pi as never);
	const emit = async (name: string, payload: Record<string, unknown> = {}) => {
		let result: unknown;
		for (const h of handlers.get(name) ?? []) result = (await h({ type: name, ...payload }, ctx)) ?? result;
		return result;
	};
	sessions.push(() => emit("session_shutdown"));
	const settle = async () => {
		await emit("agent_settled");
		pi.events.emit("post-run-verifier:settled", {});
	};
	return { emit, settle, sent };
}

const pendingDir = (tree: string) => join(tree, ".pi", "agent-review", "pending");
const pendingIds = (tree: string) =>
	existsSync(pendingDir(tree)) ? readdirSync(pendingDir(tree)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : [];
const refsOf = (root: string, id: string) => git(root, "for-each-ref", "--format=%(refname)", `refs/agent-review/${id}/`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One finished run in `tree` that leaves a pending review; the session stays open.
async function pendingRun(tree: string, content = "agent edit\n") {
	const session = start(tree);
	await session.emit("session_start");
	await session.emit("input", { text: "work", source: "interactive" });
	await session.emit("agent_start");
	writeFileSync(join(tree, "tracked.txt"), content);
	await session.settle();
	for (let i = 0; i < 100 && pendingIds(tree).length === 0; i++) await sleep(50);
	const [id] = pendingIds(tree);
	assert.ok(id, "no pending review appeared");
	const record = JSON.parse(readFileSync(join(pendingDir(tree), `${id}.json`), "utf8"));
	return { id, record, session };
}

const run = (cwd: string, ...args: string[]) => {
	const r = spawnSync(cli, args, { cwd, encoding: "utf8" });
	return { status: r.status, json: JSON.parse(r.stdout) };
};
const listAll = (cwd: string) => run(cwd, "list", "--all", "--json").json as Array<Record<string, unknown>>;

const approveWith = (cwd: string, id: string) => {
	const r = spawnSync("python3", ["-I", "-c", `
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader("agent_review", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("agent_review", loader))
loader.exec_module(m)
m.confirm = lambda *a: True
sys.argv = ["agent-review", "approve", sys.argv[2]]
raise SystemExit(m.main())
`, cli, id], { cwd, encoding: "utf8" });
	return { status: r.status, json: JSON.parse(r.stdout) };
};

test("list --all finds a review pending in another worktree", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-x");
	const { id } = await pendingRun(wt);
	const entry = listAll(root).find((e) => e.runId === id);
	assert.ok(entry, "review in the sibling worktree is listed from the root");
	assert.equal(entry.owner, wt);
	assert.equal(entry.branch, "feat-x");
	assert.equal(entry.name, "feat-x");
	assert.ok(String(entry.startedAt).length > 0);
	assert.equal(entry.landed, false);
	assert.equal(entry.orphan, false);
	assert.equal(entry.processing, false);
});

test("landed when main contains the run", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-landed");
	const { id, record } = await pendingRun(wt);
	git(root, "update-ref", "refs/remotes/origin/main", record.end); // main now has the run's change
	assert.equal(listAll(root).find((e) => e.runId === id)?.landed, true);
});

test("not landed and touches nothing", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-open");
	const { id } = await pendingRun(wt);
	const index = resolve(wt, git(wt, "rev-parse", "--git-path", "index")); // absolute in a linked worktree
	const before = { status: git(wt, "status", "--porcelain"), index: readFileSync(index).toString("hex") };
	assert.equal(listAll(root).find((e) => e.runId === id)?.landed, false);
	assert.deepEqual({ status: git(wt, "status", "--porcelain"), index: readFileSync(index).toString("hex") }, before);
});

test("orphan refs are listed", () => {
	const root = makeRepo();
	const id = randomUUID();
	git(root, "update-ref", `refs/agent-review/${id}/base`, "HEAD");
	const entry = listAll(root).find((e) => e.runId === id);
	assert.ok(entry);
	assert.equal(entry.orphan, true);
	assert.equal(entry.owner, null);
});

test("approve by id from the root acts in the owner", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-approve");
	const { id } = await pendingRun(wt);
	const out = approveWith(root, id);
	assert.equal(out.json.ok, true, JSON.stringify(out.json));
	assert.ok(existsSync(join(wt, ".pi", "agent-review", "decisions", `${id}.json`)), "decision written in the owner");
	assert.ok(!existsSync(join(root, ".pi", "agent-review", "decisions", `${id}.json`)), "nothing written in the root");
	assert.deepEqual(pendingIds(wt), []);
	const second = await pendingRun(wt, "second edit\n");
	writeFileSync(join(wt, "tracked.txt"), "changed after the run\n");
	const refused = approveWith(root, second.id);
	assert.equal(refused.json.reason, "tree-changed", "the endTree check still applies in the owner");
	assert.deepEqual(pendingIds(wt), [second.id]);
});

test("skip by id consumes with no follow-up", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-skip");
	const sibling = addWorktree(root, "feat-sibling");
	const { id, session } = await pendingRun(wt); // its watcher stays live
	const out = run(root, "skip", id);
	assert.equal(out.json.ok, true, JSON.stringify(out.json));
	assert.deepEqual(pendingIds(wt), []);
	assert.equal(refsOf(root, id), "");
	assert.ok(JSON.parse(readFileSync(join(wt, ".pi", "agent-review", "decisions", `${id}.json`), "utf8")).skipped);
	await sleep(500);
	assert.deepEqual(session.sent, [], "a live Pi session must not get a follow-up for a CLI skip");
	const next = await pendingRun(wt, "another edit\n");
	assert.equal(run(sibling, "skip", next.id).json.ok, true, "skip also works from a sibling worktree");
	assert.deepEqual(pendingIds(wt), []);
});

test("skip refuses during processing", async () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-busy");
	const { id } = await pendingRun(wt);
	renameSync(join(pendingDir(wt), `${id}.json`), join(pendingDir(wt), `${id}.processing`));
	const out = run(root, "skip", id);
	assert.equal(out.json.reason, "processing");
	assert.equal(out.status, 2);
	assert.ok(existsSync(join(pendingDir(wt), `${id}.processing`)));
	assert.notEqual(refsOf(root, id), "", "refs untouched");
});

test("skip clears orphan refs", () => {
	const root = makeRepo();
	const id = randomUUID();
	git(root, "update-ref", `refs/agent-review/${id}/base`, "HEAD");
	git(root, "update-ref", `refs/agent-review/${id}/end`, "HEAD");
	const out = run(root, "skip", id);
	assert.equal(out.json.ok, true);
	assert.equal(out.json.orphan, true);
	assert.equal(refsOf(root, id), "");
});

test("gate stays per worktree", async () => {
	const root = makeRepo();
	const busy = addWorktree(root, "feat-busy-gate");
	const free = addWorktree(root, "feat-free");
	await pendingRun(busy);
	const other = start(free);
	await other.emit("session_start");
	assert.deepEqual(await other.emit("input", { text: "work", source: "interactive" }), { action: "continue" });
	const same = start(busy);
	await same.emit("session_start");
	assert.deepEqual(await same.emit("input", { text: "more", source: "interactive" }), { action: "handled" });
});
