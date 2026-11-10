// Run: node --test scripts/pi-changes-logic.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";

import { refsFor, rangeArgs, runFrom, RUN_READ } from "../herdr-app/.config/herdr-app/mods/pi-changes/logic.js";

const ID = "11111111-2222-4333-8444-555555555555";

test("a complete run is picked, and its name defaults to the short id", () => {
	assert.deepEqual(runFrom({ runId: ID, cwd: "/repo", name: "fix-login" }), { runId: ID, cwd: "/repo", name: "fix-login" });
	assert.equal(runFrom({ runId: ID, cwd: "/repo" }).name, "11111111");
	assert.equal(runFrom({ runId: ID, cwd: "/repo", name: "" }).name, "11111111");
});

test("no value, or an incomplete one, is the working-tree view", () => {
	assert.equal(runFrom(undefined), null);
	assert.equal(runFrom(null), null);
	assert.equal(runFrom("run"), null);
	assert.equal(runFrom({ cwd: "/repo", name: "x" }), null);
	assert.equal(runFrom({ runId: ID, name: "x" }), null);
	assert.equal(runFrom({ runId: ID, cwd: "", name: "x" }), null);
});

test("a run id that is not a lowercase UUID is rejected before it can reach a ref", () => {
	for (const bad of [
		"not-a-uuid",
		"11111111-2222-4333-8444-55555555555G",
		"11111111-2222-4333-8444-5555555555555",
		"11111111-2222-4333-8444-55555555555",
		"11111111-2222-4333-8444-55555555555A",
		"../../etc/passwd",
		"11111111-2222-4333-8444-555555555555/../x",
	]) {
		assert.equal(runFrom({ runId: bad, cwd: "/repo" }), null, bad);
		assert.equal(refsFor(bad), null, bad);
	}
});

test("refs are the run's base and end under refs/agent-review", () => {
	assert.deepEqual(refsFor(ID), {
		base: `refs/agent-review/${ID}/base`,
		end: `refs/agent-review/${ID}/end`,
	});
});

test("the file list diffs base against end, read-only, with numstat", () => {
	const args = rangeArgs(refsFor(ID));
	assert.deepEqual(args.slice(0, RUN_READ.length), RUN_READ);
	assert.deepEqual(args.slice(RUN_READ.length), [
		"diff",
		`refs/agent-review/${ID}/base`,
		`refs/agent-review/${ID}/end`,
		"--numstat",
		"-z",
		"--no-renames",
	]);
});

test("a file's diff is the same range, limited to that path", () => {
	const args = rangeArgs(refsFor(ID), "src/a b.js");
	assert.deepEqual(args.slice(RUN_READ.length), [
		"diff",
		`refs/agent-review/${ID}/base`,
		`refs/agent-review/${ID}/end`,
		"--no-ext-diff",
		"--no-textconv",
		"--no-color",
		"--",
		"src/a b.js",
	]);
});

test("the read switches match the working-tree view, so a read writes nothing under .git", () => {
	assert.deepEqual(RUN_READ, ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"]);
});
