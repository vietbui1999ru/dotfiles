// Run: node --test scripts/pi-monitor-feed.test.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { countTools, modelOf, outcomeOf, reconcileReviews, sessionIdOf } from "./pi-monitor-feed.mjs";

const CLI = new URL("./pi-monitor-feed.mjs", import.meta.url).pathname;
// Under a sentinel value, so a leak into the output is caught.
const SECRET = "SENTINEL-ENV-VALUE-7731";

// A pueue fake that prints the JSON file named by STUB_PUEUE_FILE, or fails.
function fakePueue(json, { fail = false } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pmf-"));
	const bin = join(dir, "pueue");
	const file = join(dir, "status.json");
	writeFileSync(file, json);
	writeFileSync(
		bin,
		fail
			? "#!/bin/sh\nexit 1\n"
			: `#!/bin/sh\ncat "${file}"\n`,
	);
	chmodSync(bin, 0o755);
	return { bin, dir };
}

// A HOME with one Pi session file for `cwd` and `sessionId`, holding `lines` of JSONL.
function fakeHome(cwd, sessionId, lines) {
	const home = mkdtempSync(join(tmpdir(), "pmf-home-"));
	const dirName = `--${cwd.replace(/^\/+/, "").replaceAll("/", "-")}--`;
	const dir = join(home, ".pi", "agent", "sessions", dirName);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `2026-11-09T10-00-00_${sessionId}.jsonl`), lines.join("\n") + "\n");
	return home;
}

const run = (args, { bin, home }) =>
	execFileSync(process.execPath, [CLI, ...args], {
		env: { ...process.env, PUEUE_BIN: bin, HOME: home },
		encoding: "utf8",
	});

const assistantLine = (text, extra = {}) =>
	JSON.stringify({
		type: "message",
		timestamp: "2026-11-09T10:00:05Z",
		message: {
			role: "assistant",
			provider: "opencode-go",
			model: "claude-haiku-5-5",
			content: [{ type: "text", text }, ...(extra.tool ? [{ type: "toolCall", name: "bash", arguments: { command: "ls -la" } }] : [])],
			usage: { totalTokens: 1200, cost: { total: 0.0042 } },
			...(extra.error ? { stopReason: "error", errorMessage: extra.error } : {}),
		},
	});

const pueueRow = (id, command, status, extra = {}) => ({
	id,
	label: `slice-${id}`,
	command,
	original_command: command,
	path: extra.path ?? "/tmp/no-such-worktree",
	status,
	exit: extra.exit,
	envs: { TOKEN: SECRET },
});

const Done = (result, start = "2026-11-09T10:00:00Z", end = "2026-11-09T10:01:00Z") => ({
	Done: { enqueued_at: start, start, end, result },
});
const Running = (start = "2026-11-09T10:00:00Z") => ({ Running: { enqueued_at: start, start } });

test("outcome: exit 3 on a failed task is review, not failed", () => {
	assert.equal(outcomeOf(Done("Success")), "success");
	assert.equal(outcomeOf(Done({ Failed: 3 })), "review");
	assert.equal(outcomeOf(Done({ Failed: 1 })), "failed");
	assert.equal(outcomeOf(Done("Killed")), "killed");
	assert.equal(outcomeOf(Running()), "running");
	assert.equal(outcomeOf("Queued"), "queued");
	assert.equal(outcomeOf("Paused"), "paused");
	assert.equal(outcomeOf("Killed"), "killed");
});

test("sessionIdOf and modelOf read the flags of a pi-view command", () => {
	const cmd = `pi-view --tui pi --model opencode-go/deepseek-v4:medium --session-id pueue-x-1 -p "$(cat t)"`;
	assert.equal(sessionIdOf(cmd), "pueue-x-1");
	assert.deepEqual(modelOf(cmd), { model: "opencode-go/deepseek-v4", effort: "medium" });
	assert.deepEqual(modelOf("pi --model opencode-go/x"), { model: "opencode-go/x", effort: undefined });
});

test("countTools counts toolCall blocks in a chunk", () => {
	assert.equal(countTools(`{"type":"toolCall"}\n{"type":"text"}\n{"type":"toolCall"}`), 2);
});

test("the feed lists Pi tasks newest first, maps outcomes, and leaks no env or command", () => {
	const cwd = "/tmp/pmf-wt";
	const home = fakeHome(cwd, "pueue-slice-2", [assistantLine("hello there", { tool: true })]);
	const json = JSON.stringify({
		tasks: {
			1: pueueRow(1, `pi-view --model opencode-go/a:low --session-id pueue-old-1 -p x`, Done("Success")),
			2: pueueRow(2, `pi-view --model opencode-go/b:high --session-id pueue-slice-2 -p "$(cat t)"`, Running(), { path: cwd }),
			3: pueueRow(3, `pi-view --model opencode-go/c --session-id pueue-q-3 -p x`, "Queued"),
			4: pueueRow(4, `unrelated command with no session`, Done("Success")),
		},
	});
	const pueue = fakePueue(json);
	const out = run([], { bin: pueue.bin, home });
	assert.ok(!out.includes(SECRET), "pueue envs must not reach the output");
	assert.ok(!out.includes("pi-view --model"), "a task's full command must not reach the output");
	const feed = JSON.parse(out);
	assert.deepEqual(feed.tasks.map((t) => t.id), [3, 2, 1], "newest first, only session tasks");
	const byId = Object.fromEntries(feed.tasks.map((t) => [t.id, t]));
	assert.equal(byId[2].outcome, "running");
	assert.equal(byId[3].outcome, "queued");
	assert.equal(byId[2].session, "pueue-slice-2");
	assert.equal(byId[2].model, "opencode-go/claude-haiku-5-5");
	assert.equal(byId[2].tools, 1);
	assert.equal(byId[2].files, 0);
	assert.equal(byId[2].tokens, 1200);
	assert.equal(byId[2].activity, "bash ls -la");
	assert.equal(feed.summary.running, 1);
	assert.equal(feed.summary.queued, 1);
	assert.equal(feed.detail.id, 2, "the newest running task is the detail");
	assert.ok(feed.detail.entries.some((e) => e.kind === "text" && e.text === "hello there"));
});

test("--task picks the named task for the detail", () => {
	const json = JSON.stringify({
		tasks: {
			5: pueueRow(5, `pi-view --session-id pueue-a-5 -p x`, Done("Success")),
			6: pueueRow(6, `pi-view --session-id pueue-b-6 -p x`, Running()),
		},
	});
	const pueue = fakePueue(json);
	const home = fakeHome("/tmp/no-such-worktree", "pueue-a-5", [assistantLine("from five")]);
	const feed = JSON.parse(run(["--task", "5"], { bin: pueue.bin, home }));
	assert.equal(feed.detail.id, 5);
});

test("transcript text is cut to 2000 characters", () => {
	const long = "x".repeat(3000);
	const json = JSON.stringify({ tasks: { 7: pueueRow(7, `pi-view --session-id pueue-l-7 -p x`, Done("Success")) } });
	const home = fakeHome("/tmp/no-such-worktree", "pueue-l-7", [assistantLine(long)]);
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home }));
	const text = feed.detail.entries.find((e) => e.kind === "text").text;
	assert.equal(text.length, 2000);
});

test("a missing session file gives zero counts and empty entries, not an error", () => {
	const json = JSON.stringify({ tasks: { 8: pueueRow(8, `pi-view --session-id pueue-none-8 -p x`, Running()) } });
	const home = mkdtempSync(join(tmpdir(), "pmf-empty-"));
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home }));
	assert.equal(feed.tasks[0].tokens, 0);
	assert.equal(feed.tasks[0].cost, 0);
	assert.equal(feed.tasks[0].tools, 0);
	assert.deepEqual(feed.detail.entries, []);
});

test("an error turn is reported as an error entry", () => {
	const json = JSON.stringify({ tasks: { 9: pueueRow(9, `pi-view --session-id pueue-e-9 -p x`, Done({ Failed: 1 })) } });
	const home = fakeHome("/tmp/no-such-worktree", "pueue-e-9", [assistantLine("", { error: "rate limited" })]);
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home }));
	assert.ok(feed.detail.entries.some((e) => e.kind === "error" && e.text === "rate limited"));
});

test("pueue unreachable prints an unavailable feed and exits 0", () => {
	const home = mkdtempSync(join(tmpdir(), "pmf-down-"));
	const pueue = fakePueue("", { fail: true });
	const out = JSON.parse(run([], { bin: pueue.bin, home }));
	assert.deepEqual(out, { tasks: [], unavailable: true });
});

test("outcome: Stashed and Locked are queued, not failed", () => {
	assert.equal(outcomeOf("Stashed"), "queued");
	assert.equal(outcomeOf({ Stashed: { enqueued_at: "2026-11-09T10:00:00Z" } }), "queued");
	assert.equal(outcomeOf({ Locked: { enqueued_at: "2026-11-09T10:00:00Z" } }), "queued");
});

// A pending record file as Pi writes it, for one repo.
const pendingJson = (runId, { session, startedAt = "2026-11-09T10:00:00Z" } = {}) =>
	JSON.stringify({ runId, session, startedAt, files: [{ file: "a.ts" }] });

// A repo with a .pi/agent-review/pending folder holding the given records (name -> json).
function fakeRepo(records) {
	const repo = mkdtempSync(join(tmpdir(), "pmf-repo-"));
	const dir = join(repo, ".pi", "agent-review", "pending");
	mkdirSync(dir, { recursive: true });
	for (const [name, json] of Object.entries(records)) writeFileSync(join(dir, name), json);
	return repo;
}

test("exit 3 with no pending record is reviewed and not counted as needing review", () => {
	const repo = fakeRepo({});
	const json = JSON.stringify({
		tasks: { 20: pueueRow(20, `pi-view --session-id pueue-r-20 -p x`, Done({ Failed: 3 }), { path: repo }) },
	});
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home: mkdtempSync(join(tmpdir(), "pmf-h-")) }));
	assert.equal(feed.tasks[0].outcome, "reviewed");
	assert.equal(feed.summary.review, 0);
});

test("on a path with a record, the newest exit-3 task is review and older ones are reviewed", () => {
	const repo = fakeRepo({ "r.json": pendingJson("run-1") });
	const json = JSON.stringify({
		tasks: {
			30: pueueRow(30, `pi-view --session-id pueue-old-30 -p x`, Done({ Failed: 3 }), { path: repo }),
			31: pueueRow(31, `pi-view --session-id pueue-new-31 -p x`, Done({ Failed: 3 }), { path: repo }),
		},
	});
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home: mkdtempSync(join(tmpdir(), "pmf-h-")) }));
	const byId = Object.fromEntries(feed.tasks.map((t) => [t.id, t]));
	assert.equal(byId[31].outcome, "review");
	assert.equal(byId[30].outcome, "reviewed");
	assert.equal(feed.summary.review, 1);
});

test("a running task whose session wrote a pending record is review", () => {
	const repo = fakeRepo({ "r.json": pendingJson("run-2", { session: "pueue-live-40" }) });
	const json = JSON.stringify({
		tasks: { 40: pueueRow(40, `pi-view --session-id pueue-live-40 -p x`, Running(), { path: repo }) },
	});
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home: mkdtempSync(join(tmpdir(), "pmf-h-")) }));
	assert.equal(feed.tasks[0].outcome, "review");
});

test("a missing pending folder is no record, not an error", () => {
	const json = JSON.stringify({
		tasks: { 50: pueueRow(50, `pi-view --session-id pueue-m-50 -p x`, Done({ Failed: 3 }), { path: "/tmp/pmf-no-such-repo" }) },
	});
	const feed = JSON.parse(run([], { bin: fakePueue(json).bin, home: mkdtempSync(join(tmpdir(), "pmf-h-")) }));
	assert.equal(feed.tasks[0].outcome, "reviewed");
	assert.equal(feed.unavailable, undefined);
});

// reconcileReviews carries the waiting record's run id onto the task, so the monitor can open
// that run's changes. A task that is no longer waiting carries none.
test("a review task that still waits carries its record's runId", () => {
	const tasks = [{ id: 7, path: "/repo", outcome: "review", session: "s7" }];
	const records = new Map([["/repo", [{ runId: "11111111-2222-4333-8444-555555555555", startedAt: 1 }]]]);
	const [task] = reconcileReviews(tasks, records);
	assert.equal(task.outcome, "review");
	assert.equal(task.reviewRunId, "11111111-2222-4333-8444-555555555555");
});

test("a running task that wrote its record carries that record's runId", () => {
	const tasks = [{ id: 8, path: "/repo", outcome: "running", session: "pueue-live-8" }];
	const records = new Map([["/repo", [{ runId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", session: "pueue-live-8" }]]]);
	const [task] = reconcileReviews(tasks, records);
	assert.equal(task.outcome, "review");
	assert.equal(task.reviewRunId, "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
});

test("a review task whose record is gone is reviewed, with no runId", () => {
	const tasks = [{ id: 9, path: "/repo", outcome: "review", session: "s9" }];
	const [task] = reconcileReviews(tasks, new Map());
	assert.equal(task.outcome, "reviewed");
	assert.equal(task.reviewRunId, undefined);
});

test("an older review task on the same path is reviewed, with no runId", () => {
	const tasks = [
		{ id: 12, path: "/repo", outcome: "review", session: "s12" },
		{ id: 11, path: "/repo", outcome: "review", session: "s11" },
	];
	const records = new Map([["/repo", [{ runId: "11111111-2222-4333-8444-555555555555", startedAt: 1 }]]]);
	const [newest, older] = reconcileReviews(tasks, records);
	assert.equal(newest.reviewRunId, "11111111-2222-4333-8444-555555555555");
	assert.equal(older.outcome, "reviewed");
	assert.equal(older.reviewRunId, undefined);
});
