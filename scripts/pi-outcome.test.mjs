// Run: node --test scripts/pi-outcome.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { diffHash } from "../session-band-plugin/hooks/outcome.ts";

const CLI = new URL("./pi-outcome", import.meta.url).pathname;

const PUEUE_STUB = `#!/usr/bin/env node
import { appendFileSync, readFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG ?? "/dev/null", JSON.stringify(process.argv.slice(2)) + "\\n");
process.stdout.write(process.env.STUB_PUEUE_FILE ? readFileSync(process.env.STUB_PUEUE_FILE, "utf8") : process.env.STUB_PUEUE_JSON ?? "{}");
process.exitCode = Number(process.env.STUB_PUEUE_EXIT ?? "0");
`;

const done = { Done: { enqueued_at: "2026-10-29T00:00:00Z", start: "2026-10-29T00:00:01Z", end: "2026-10-29T00:00:02Z", result: "Success" } };

function sandbox(taskId = 7) {
	const dir = mkdtempSync(join(tmpdir(), "pi-outcome-test-"));
	const worktree = join(dir, "repo");
	const home = join(dir, "home");
	const state = join(dir, "state");
	const runs = join(dir, "run");
	const bins = join(dir, "bin");
	for (const path of [worktree, home, state, runs, bins]) mkdirSync(path);

	const git = (...args) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd: worktree, stdio: "pipe" });
	git("init", "-q", "-b", "main");
	writeFileSync(join(worktree, "a.txt"), "one\n");
	git("add", "a.txt");
	git("commit", "-q", "-m", "one");
	const head = execFileSync("git", ["rev-parse", "HEAD"], { cwd: worktree, encoding: "utf8" }).trim();
	const currentDiffHash = () => diffHash(execFileSync("git", ["diff", "HEAD"], { cwd: worktree, encoding: "utf8" }));

	const pueue = join(bins, "pueue.mjs");
	writeFileSync(pueue, PUEUE_STUB);
	chmodSync(pueue, 0o755);

	const pueueStatus = (id = taskId) => JSON.stringify({ tasks: {
		[String(id)]: { id, label: "x", path: worktree, command: "pi --model openai/gpt:high --session-id pueue-x -p hi", created_at: "2026-10-29T00:00:00Z", status: done },
	} });

	return {
		worktree,
		head,
		currentDiffHash,
		pueueStatus,
		record: (value) => writeFileSync(join(state, "pueue-x.json"), `${JSON.stringify(value)}\n`),
		pending: (value = { runId: "run-1", files: [{ file: "a.txt" }] }) => {
			const path = join(worktree, ".pi", "agent-review", "pending");
			mkdirSync(path, { recursive: true });
			writeFileSync(join(path, "run-1.json"), `${JSON.stringify(value)}\n`);
		},
		run: (args = [], env = {}) => spawnSync(CLI, [String(taskId), ...args], {
			encoding: "utf8",
			env: {
				...process.env,
				HOME: home,
				TMPDIR: dir,
				PI_CHECKS_STATE: state,
				PI_VIEW_RUN_DIR: runs,
				PUEUE_BIN: pueue,
				HERDR_BIN_PATH: join(bins, "missing-herdr"),
				STUB_PUEUE_JSON: pueueStatus(),
				...env,
			},
		}),
	};
}

test("prints checks passed for a passing record", () => {
	const box = sandbox();
	box.record({ phase: "done", commit: box.head, diffHash: box.currentDiffHash(), specStatus: "approved", passed: true, round: 0, steered: false });
	const run = box.run();
	assert.equal(run.status, 0);
	assert.equal(run.stdout, "pi#7 checks passed\n");
});

test("--json carries round and reviewWaiting", () => {
	const box = sandbox();
	box.record({ phase: "done", commit: box.head, diffHash: box.currentDiffHash(), specStatus: "approved", passed: false, round: 2, steered: true });
	box.pending();
	const run = box.run(["--json"]);
	assert.equal(run.status, 0);
	assert.deepEqual(JSON.parse(run.stdout), { id: 7, outcome: "fixing", round: 2, tone: "yellow", reviewWaiting: true });
});

test("reads a pueue status larger than 1 MB", () => {
	// pueue keeps every task's environment, so the real status is often over spawnSync's 1 MB default.
	const box = sandbox();
	box.record({ phase: "done", commit: box.head, diffHash: box.currentDiffHash(), specStatus: "approved", passed: true, round: 0, steered: false });
	const status = JSON.parse(box.pueueStatus());
	status.tasks["7"].envs = { PADDING: "x".repeat(2 * 1024 * 1024) };
	const file = join(box.worktree, "..", "status.json");
	writeFileSync(file, JSON.stringify(status));
	const run = box.run([], { STUB_PUEUE_FILE: file });
	assert.equal(run.status, 0, run.stderr.slice(0, 200));
	assert.equal(run.stdout, "pi#7 checks passed\n");
});

test("a failing pueue never echoes its output", () => {
	// The output holds every task's environment, API keys included.
	const box = sandbox();
	const run = box.run([], { STUB_PUEUE_JSON: '{"envs":{"API_KEY":"SECRET-TOKEN"}}', STUB_PUEUE_EXIT: "1" });
	assert.equal(run.status, 1);
	assert.match(run.stderr, /pi-outcome: could not read pueue status/);
	assert.doesNotMatch(run.stderr, /SECRET-TOKEN/);
});

test("a running --tui run shows its own pending review", () => {
	// A --tui run stays Running in pueue while its review waits; its record names its Pi session.
	const box = sandbox();
	box.record({ phase: "done", commit: box.head, diffHash: box.currentDiffHash(), specStatus: "approved", passed: true, round: 0, steered: false });
	box.pending({ runId: "run-1", session: "pueue-x", files: [{ file: "a.txt" }] });
	const status = JSON.parse(box.pueueStatus());
	status.tasks["7"].status = { Running: { enqueued_at: "2026-10-29T00:00:00Z", start: "2026-10-29T00:00:01Z" } };
	const run = box.run(["--json"], { STUB_PUEUE_JSON: JSON.stringify(status) });
	assert.equal(run.status, 0, run.stderr);
	assert.equal(JSON.parse(run.stdout).reviewWaiting, true);
});

test("unknown task exits 2", () => {
	const box = sandbox();
	const run = box.run([], { STUB_PUEUE_JSON: box.pueueStatus(8) });
	assert.equal(run.status, 2);
	assert.match(run.stderr, /pi-outcome: no pueue task 7/);
});
