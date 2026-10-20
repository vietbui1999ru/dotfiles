// Reviews across repos (SPEC: agent-review list --global, Track A). Each test points
// XDG_STATE_HOME at its own temporary directory, so the real registry is never read
// or written, and runs Pi in-process (registration) or the real CLI (listing).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import nodeTest, { after } from "node:test";
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

let state = "";
const registry = () => join(state, "agent-review", "repos");
const registered = () => (existsSync(registry()) ? readFileSync(registry(), "utf8").split("\n").filter(Boolean) : []);
// Each test gets its own state directory. Not beforeEach: bun skips it under `-t`.
const test = (name: string, fn: () => unknown) =>
	nodeTest(name, async () => {
		state = tmp("agent-review-state-");
		process.env.XDG_STATE_HOME = state;
		await fn();
	});

function makeRepo(): string {
	const root = tmp("agent-review-global-");
	git(root, "init", "-q", "-b", "main");
	git(root, "config", "user.email", "test@example.com");
	git(root, "config", "user.name", "test");
	writeFileSync(join(root, "tracked.txt"), "base\n");
	writeFileSync(join(root, ".gitignore"), "/.pi/agent-review/\n");
	git(root, "add", "-A");
	git(root, "commit", "-qm", "base");
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
		sendUserMessage: () => {},
	};
	agentReview(pi as never);
	const emit = async (name: string, payload: Record<string, unknown> = {}) => {
		for (const h of handlers.get(name) ?? []) await h({ type: name, ...payload }, ctx);
	};
	sessions.push(() => emit("session_shutdown"));
	return { emit, settle: async () => { await emit("agent_settled"); pi.events.emit("post-run-verifier:settled", {}); } };
}

const pendingDir = (tree: string) => join(tree, ".pi", "agent-review", "pending");
const pendingIds = (tree: string) =>
	existsSync(pendingDir(tree)) ? readdirSync(pendingDir(tree)).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : [];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// One finished Pi run in `tree` that leaves a pending review.
async function pendingRun(tree: string): Promise<string> {
	const session = start(tree);
	await session.emit("session_start");
	await session.emit("input", { text: "work", source: "interactive" });
	await session.emit("agent_start");
	writeFileSync(join(tree, "tracked.txt"), `agent edit ${Math.random()}\n`);
	await session.settle();
	for (let i = 0; i < 100 && pendingIds(tree).length === 0; i++) await sleep(50);
	const [id] = pendingIds(tree);
	assert.ok(id, "no pending review appeared");
	return id;
}

const cliRun = (cwd: string, ...args: string[]) => {
	const r = spawnSync(cli, args, { cwd, encoding: "utf8", env: { ...process.env, XDG_STATE_HOME: state } });
	return { status: r.status, stdout: r.stdout, stderr: r.stderr };
};
const listGlobal = (cwd: string) => {
	const r = cliRun(cwd, "list", "--global", "--json");
	assert.equal(r.status, 0, r.stderr);
	assert.equal(r.stdout.trimEnd().split("\n").length, 1, "one JSON line");
	return JSON.parse(r.stdout) as Array<Record<string, unknown>>;
};
const register = (...paths: string[]) => {
	mkdirSync(dirname(registry()), { recursive: true });
	writeFileSync(registry(), paths.map((p) => `${p}\n`).join(""));
};

test("pending record registers the repo once", async () => {
	const root = makeRepo();
	await pendingRun(addWorktree(root, "feat-x"));
	assert.deepEqual(registered(), [root], "the main worktree, not the linked one");
	await pendingRun(root);
	assert.deepEqual(registered(), [root], "a second run adds no duplicate");
});

test("registry failure keeps the pending record", async () => {
	const root = makeRepo();
	const blocker = join(tmp("agent-review-block-"), "file");
	writeFileSync(blocker, "not a directory\n");
	process.env.XDG_STATE_HOME = blocker;
	await pendingRun(root);
	assert.equal(pendingIds(root).length, 1);
});

test("register is idempotent and uses the main worktree", () => {
	const root = makeRepo();
	const wt = addWorktree(root, "feat-r");
	for (let i = 0; i < 2; i++) assert.equal(cliRun(wt, "register").status, 0);
	assert.deepEqual(registered(), [root]);
});

test("list --global finds a review in another repo", async () => {
	const a = makeRepo();
	const b = makeRepo();
	const id = await pendingRun(b);
	register(b);
	const entry = listGlobal(a).find((e) => e.runId === id);
	assert.ok(entry, "repo B's review is listed from repo A");
	assert.equal(entry.repo, b);
	assert.equal(entry.owner, b);
	for (const key of ["runId", "owner", "branch", "name", "startedAt", "processing", "error", "landed", "orphan"]) {
		assert.ok(key in entry, `field ${key}`);
	}
});

test("list --global outside a repo orders entries", async () => {
	const a = makeRepo();
	const b = makeRepo();
	const first = await pendingRun(a);
	await sleep(20);
	const second = await pendingRun(b);
	const orphan = "33333333-3333-4333-8333-333333333333";
	git(a, "update-ref", `refs/agent-review/${orphan}/base`, "HEAD");
	register(a, b);
	const entries = listGlobal(tmp("agent-review-outside-"));
	assert.deepEqual(entries.map((e) => e.runId), [first, second, orphan]);
	assert.deepEqual(entries.map((e) => e.repo), [a, b, a]);
});

test("stale registry lines are skipped", async () => {
	const a = makeRepo();
	const id = await pendingRun(a);
	register(join(tmp("agent-review-gone-"), "missing"), tmp("agent-review-plain-"), a, a, "");
	assert.deepEqual(listGlobal(tmp("agent-review-outside-")).map((e) => e.runId), [id]);
});

test("no registry falls back to the current repo", async () => {
	const a = makeRepo();
	const id = await pendingRun(a);
	rmSync(join(state, "agent-review"), { recursive: true, force: true });
	assert.deepEqual(listGlobal(a).map((e) => e.runId), [id]);
	assert.deepEqual(listGlobal(tmp("agent-review-outside-")), []);
});
