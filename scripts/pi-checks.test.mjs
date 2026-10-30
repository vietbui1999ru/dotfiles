// Run: node --test scripts/pi-checks.test.mjs
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const PI_CHECKS = new URL("./pi-checks.mjs", import.meta.url).pathname;

const gitc = (cwd, args) => execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", "-c", "commit.gpgsign=false", ...args], { cwd, stdio: "pipe" });

// Each stub logs its argv to STUB_LOG and exits with the code its environment names.
const AC_RUN_STUB = `#!/usr/bin/env node
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(["ac-run", ...args]) + "\\n");
const exit = Number(process.env.STUB_AC_EXIT ?? "0");
const at = args.indexOf("--record");
if (at >= 0) {
	const path = args[at + 1];
	mkdirSync(dirname(path), { recursive: true });
	const body = process.env.STUB_AC_RECORD ?? JSON.stringify({ spec: "SPEC.md", specHash: "h", branch: "main", exit, acs: {} });
	writeFileSync(path, body + "\\n");
}
process.exit(exit);
`;

const FLOOR_GUARD_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify(["floor-guard", ...process.argv.slice(2)]) + "\\n");
if (process.env.STUB_FLOOR_OUTPUT) process.stdout.write(process.env.STUB_FLOOR_OUTPUT);
process.exit(Number(process.env.STUB_FLOOR_EXIT ?? "0"));
`;

const HERDR_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(["herdr", ...args]) + "\\n");
if (args[0] === "pane" && args[1] === "get") {
	const exit = Number(process.env.STUB_HERDR_GET_EXIT ?? "0");
	if (exit !== 0) process.exit(exit);
	process.stdout.write(JSON.stringify({ result: { pane: { pane_id: args[2] } } }) + "\\n");
}
process.exit(0);
`;

// Delegates to the real git unless STUB_GIT_FAIL names the subcommand to break.
const GIT_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(["git", ...args]) + "\\n");
if (process.env.STUB_GIT_FAIL && args.join(" ").includes(process.env.STUB_GIT_FAIL)) process.exit(1);
const real = spawnSync(process.env.REAL_GIT, args, { encoding: "utf8" });
process.stdout.write(real.stdout ?? "");
process.stderr.write(real.stderr ?? "");
process.exit(real.status ?? 1);
`;

const STUB_SOURCE = { acRun: AC_RUN_STUB, floorGuard: FLOOR_GUARD_STUB, herdr: HERDR_STUB, git: GIT_STUB };

const REAL_GIT = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();

const spec = (branch = "main", verify = "`true`") => `---
status: approved
branch: ${branch}
---

## Objective
Do the thing.

## Acceptance Criteria
- AC-1: it works
  verify: ${verify}

## Boundaries

### Always
- keep the tests green

### Ask First
- anything irreversible

### Never
- push

## Open Questions
None.
`;

const record = (acs, exit = 0) => JSON.stringify({ spec: "SPEC.md", specHash: "h", branch: "main", exit, acs });

const failing = (tail = "boom") => record({ "AC-1": { result: "fail", tail } }, 1);

function sandbox() {
	const dir = mkdtempSync(join(tmpdir(), "pi-checks-test-"));
	const worktree = join(dir, "repo");
	mkdirSync(worktree);
	gitc(worktree, ["init", "-q", "-b", "main"]);
	writeFileSync(join(worktree, "a.txt"), "one\n");
	gitc(worktree, ["add", "a.txt"]);
	gitc(worktree, ["commit", "-q", "-m", "one"]);

	const bins = join(dir, "bin");
	mkdirSync(bins);
	const stubs = {};
	for (const [key, source] of Object.entries(STUB_SOURCE)) {
		// The git stub is reached through PATH, so it keeps git's own name and no extension.
		const path = join(bins, key === "git" ? "git" : `${key}.mjs`);
		writeFileSync(path, source);
		chmodSync(path, 0o755);
		stubs[key] = path;
	}

	const state = join(dir, "state");
	const runs = join(dir, "run");
	const log = join(dir, "calls.log");
	writeFileSync(log, "");

	return {
		dir,
		worktree,
		state,
		runs,
		bins,
		stubs,
		writeSpec: (branch, verify) => writeFileSync(join(worktree, "SPEC.md"), spec(branch, verify)),
		pane: (id = "pane-1") => {
			mkdirSync(runs, { recursive: true });
			writeFileSync(join(runs, "pueue-test.pane"), `${id}\n`);
		},
		commit: (text) => {
			writeFileSync(join(worktree, "a.txt"), `${text}\n`);
			gitc(worktree, ["commit", "-q", "-am", text]);
		},
		run: (env = {}, args = []) => spawnSync(process.execPath, [PI_CHECKS, worktree, "pueue-test", ...args], {
			encoding: "utf8",
			env: {
				...process.env,
				PI_CHECKS_STATE: state,
				PI_VIEW_RUN_DIR: runs,
				AC_RUN_BIN: stubs.acRun,
				FLOOR_GUARD_BIN: stubs.floorGuard,
				HERDR_BIN_PATH: stubs.herdr,
				STUB_LOG: log,
				PUEUE_TASK_ID: "42",
				...env,
			},
		}),
		record: () => JSON.parse(readFileSync(join(state, "pueue-test.json"), "utf8")),
		hasRecord: () => existsSync(join(state, "pueue-test.json")),
		calls: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
	};
}

test("no SPEC.md records specStatus none and does not run ac-run", () => {
	const box = sandbox();
	const run = box.run();
	assert.equal(run.status, 0);
	assert.equal(box.record().specStatus, "none");
	assert.equal(box.record().phase, "done");
	assert.deepEqual(box.calls(), []);
});

test("spec for another branch records none", () => {
	const box = sandbox();
	box.writeSpec("feature/other");
	const run = box.run();
	assert.equal(run.status, 0);
	assert.equal(box.record().specStatus, "none");
	assert.equal(box.calls().some((call) => call[0] === "ac-run"), false);
});

test("ac-run exit 3 records none", () => {
	const box = sandbox();
	box.writeSpec();
	const run = box.run({ STUB_AC_EXIT: "3", STUB_AC_RECORD: JSON.stringify({ exit: 3, acs: {} }) });
	assert.equal(run.status, 0);
	assert.equal(box.record().specStatus, "none");
	assert.deepEqual(box.record().acs, {});
});

test("all-manual spec records manual-only", () => {
	const box = sandbox();
	box.writeSpec("main", "manual - a person reads it");
	const run = box.run({ STUB_AC_RECORD: record({ "AC-1": { result: "manual" } }) });
	assert.equal(run.status, 0);
	assert.equal(box.record().specStatus, "manual-only");
	assert.equal(box.calls().some((call) => call[0] === "floor-guard"), false);
});

test("passing checks record passed and send nothing", () => {
	const box = sandbox();
	box.writeSpec();
	box.pane();
	const run = box.run({ STUB_AC_RECORD: record({ "AC-1": { result: "pass" } }) });
	assert.equal(run.status, 0);
	assert.equal(box.record().passed, true);
	assert.equal(box.record().specStatus, "approved");
	assert.equal(box.record().spec, "SPEC.md");
	assert.equal(box.record().branch, "main");
	assert.deepEqual(box.calls().filter((call) => call[0] === "herdr"), []);
});

test("failing checks steer the live pane once and set round 1", () => {
	const box = sandbox();
	box.writeSpec("main", "`false`");
	box.pane();
	const run = box.run({ STUB_AC_RECORD: failing(), STUB_AC_EXIT: "1" });
	assert.equal(run.status, 0);
	assert.equal(box.record().passed, false);
	assert.equal(box.record().steered, true);
	assert.equal(box.record().round, 1);
	const herdr = box.calls().filter((call) => call[0] === "herdr");
	assert.deepEqual(herdr.map((call) => call.slice(0, 3)), [
		["herdr", "pane", "get"],
		["herdr", "pane", "send-text"],
		["herdr", "pane", "send-keys"],
	]);
	assert.equal(herdr[2][4], "Enter");
	const message = herdr[1][4];
	assert.match(message, /AC-1 failed: `false`/);
	assert.match(message, /boom/);
	assert.match(message, /Fix these, commit, and stop\.$/);
	// The review gate refuses plain input while a review is pending; a queued review batch
	// for the same session is the one input it absorbs into a new run.
	const header = /^\[review-batch ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\]$/.exec(message.split("\n")[0]);
	assert.ok(header, `no review-batch header in: ${message.split("\n")[0]}`);
	const queue = readFileSync(join(box.worktree, ".pi", "agent-review", "threads", "queue.jsonl"), "utf8")
		.trim().split("\n").map((line) => JSON.parse(line));
	const row = queue.find((entry) => entry.id === header[1]);
	assert.ok(row, "the batch is not in the review queue");
	assert.equal(row.state, "delivered");
	assert.equal(row.agent, "pi:pueue-test");
	assert.deepEqual(row.entryIds, []);
	assert.equal(typeof row.queuedAt, "string");
});

test("skips when commit and diff are unchanged", () => {
	const box = sandbox();
	box.writeSpec();
	box.pane();
	const env = { STUB_AC_RECORD: record({ "AC-1": { result: "pass" } }) };
	assert.equal(box.run(env).status, 0);
	const first = box.record();
	const ran = box.calls().filter((call) => call[0] === "ac-run").length;
	assert.equal(box.run(env).status, 0);
	assert.equal(box.record().time, first.time);
	assert.equal(box.calls().filter((call) => call[0] === "ac-run").length, ran);
});

test("a held lock makes a second run exit without writing", () => {
	const box = sandbox();
	box.writeSpec();
	mkdirSync(join(box.state, "pueue-test.lock"), { recursive: true });
	const run = box.run();
	assert.equal(run.status, 0);
	assert.equal(box.hasRecord(), false);
});

test("no live pane: no steer, no round", () => {
	const box = sandbox();
	box.writeSpec("main", "`false`");
	const run = box.run({ STUB_AC_RECORD: failing(), STUB_AC_EXIT: "1" });
	assert.equal(run.status, 0);
	assert.equal(box.record().steered, false);
	assert.equal(box.record().round, 0);
	assert.equal(box.calls().some((call) => call[0] === "herdr"), false);
});

test("third failed round steers; fourth notifies and does not steer", () => {
	const box = sandbox();
	box.writeSpec("main", "`false`");
	box.pane();
	mkdirSync(box.state, { recursive: true });
	writeFileSync(join(box.state, "pueue-test.json"), JSON.stringify({
		phase: "done", commit: "older", diffHash: "x", specStatus: "approved", passed: false, round: 2, steered: true,
	}));
	const env = { STUB_AC_RECORD: failing(), STUB_AC_EXIT: "1" };

	assert.equal(box.run(env).status, 0);
	assert.equal(box.record().round, 3);
	assert.equal(box.record().steered, true);
	assert.equal(box.calls().filter((call) => call[2] === "send-text").length, 1);

	box.commit("two");
	const before = box.calls().length;
	assert.equal(box.run(env).status, 0);
	assert.equal(box.record().round, 3);
	assert.equal(box.record().steered, false);
	const after = box.calls().slice(before);
	assert.equal(after.some((call) => call[2] === "send-text"), false);
	assert.deepEqual(after.filter((call) => call[1] === "notification"), [
		["herdr", "notification", "show", "pi#42 checks failed, needs you"],
	]);
});

test("--no-steer never steers", () => {
	const box = sandbox();
	box.writeSpec("main", "`false`");
	box.pane();
	const run = box.run({ STUB_AC_RECORD: failing(), STUB_AC_EXIT: "1" }, ["--no-steer"]);
	assert.equal(run.status, 0);
	assert.equal(box.record().steered, false);
	assert.equal(box.calls().some((call) => call[1] === "send-text"), false);
	assert.equal(box.calls().some((call) => call[1] === "notification"), false);
});

test("two failing runs at the same HEAD with different uncommitted edits steer once", () => {
	const box = sandbox();
	box.writeSpec("main", "`false`");
	box.pane();
	const env = { STUB_AC_RECORD: failing(), STUB_AC_EXIT: "1" };
	assert.equal(box.run(env).status, 0);
	assert.equal(box.record().steered, true);
	assert.equal(box.record().round, 1);

	// Pi edits without committing: the diff hash is new, HEAD is not.
	writeFileSync(join(box.worktree, "a.txt"), "edited, not committed\n");
	const before = box.calls().length;
	assert.equal(box.run(env).status, 0);
	assert.equal(box.record().steered, false);
	assert.equal(box.record().round, 1);
	const after = box.calls().slice(before);
	assert.equal(after.some((call) => call[2] === "send-text"), false);
	assert.equal(after.some((call) => call[1] === "notification"), false);
});

test("an error after the checking record leaves no checking record", () => {
	const box = sandbox();
	box.writeSpec();
	const env = { PATH: `${box.bins}:${process.env.PATH}`, REAL_GIT, STUB_GIT_FAIL: "branch" };
	const failed = box.run(env);
	assert.equal(failed.status, 0);
	assert.match(failed.stderr, /pi-checks: git branch --show-current failed/);
	assert.equal(box.hasRecord(), false);

	// A result from before the failed run is restored, never left on `checking`.
	mkdirSync(box.state, { recursive: true });
	const previous = { phase: "done", commit: "older", diffHash: "x", specStatus: "approved", passed: true, round: 1, steered: false, time: "then" };
	writeFileSync(join(box.state, "pueue-test.json"), `${JSON.stringify(previous)}\n`);
	assert.equal(box.run(env).status, 0);
	assert.deepEqual(box.record(), previous);
});

test("a lock with a dead pid is taken over", () => {
	const box = sandbox();
	box.writeSpec();
	const lock = join(box.state, "pueue-test.lock");
	mkdirSync(lock, { recursive: true });
	const dead = spawnSync(process.execPath, ["-e", ""]).pid;
	writeFileSync(join(lock, "pid"), `${dead}\n`);
	const run = box.run({ STUB_AC_RECORD: record({ "AC-1": { result: "pass" } }) });
	assert.equal(run.status, 0);
	assert.equal(box.record().phase, "done");
	assert.equal(existsSync(lock), false);
});
