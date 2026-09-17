import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import {
	modeTampered,
	needsFollowUp,
	repoRoot,
	snapshot,
	validDecision,
	validDecisionShape,
} from "./index.ts";

const dirs: string[] = [];
after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

function repo(): string {
	const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-unit-")));
	dirs.push(root);
	execFileSync("git", ["init"], { cwd: root });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
	execFileSync("git", ["config", "user.name", "test"], { cwd: root });
	writeFileSync(join(root, "tracked.txt"), "base\n");
	execFileSync("git", ["add", "-A"], { cwd: root });
	execFileSync("git", ["commit", "-m", "base"], { cwd: root });
	return root;
}

const pending = {
	runId: "123e4567-e89b-42d3-a456-426614174000",
	base: "a".repeat(40), baseTree: "b".repeat(40),
	end: "c".repeat(40), endTree: "d".repeat(40),
	files: [], startedAt: "", endedAt: "", modeMtimeMs: 1,
};

test("unchanged snapshots share a tree; distinct commits differ", async () => {
	const root = repo();
	const first = await snapshot(root, "base");
	const second = await snapshot(root, "end");
	assert.notEqual(first.commit, second.commit);
	assert.equal(first.tree, second.tree);
});

test("review state is excluded from snapshots", async () => {
	const root = repo();
	const first = await snapshot(root, "base");
	mkdirSync(join(root, ".pi", "agent-review"), { recursive: true });
	writeFileSync(join(root, ".pi", "agent-review", "pending.json"), "state\n");
	const second = await snapshot(root, "end");
	assert.equal(first.tree, second.tree);
});

test("repo root resolves from a subdirectory", async () => {
	const root = repo();
	mkdirSync(join(root, "nested"));
	assert.equal(await repoRoot(join(root, "nested")), root);
});

test("tamper detection and forged-decision rejection fail closed", () => {
	assert.equal(modeTampered(1, 2), true);
	assert.equal(modeTampered(1, 1), false);
	const good = { runId: pending.runId, endTree: pending.endTree, finalTree: "f".repeat(40), files: [], notes: [], patch: "" };
	assert.equal(validDecision(pending, good, "f".repeat(40)), true);
	assert.equal(validDecision(pending, { ...good, endTree: "e".repeat(40) }, "f".repeat(40)), false);
	assert.equal(validDecision(pending, good, "0".repeat(40)), false);
});

test("decision shape validation rejects malformed records", () => {
	const base = { runId: pending.runId, endTree: "d".repeat(40), finalTree: "f".repeat(40), files: [], notes: [], patch: "" };
	assert.equal(validDecisionShape(base), true);
	assert.equal(validDecisionShape({ ...base, patch: undefined }), false);
	assert.equal(validDecisionShape({ ...base, files: "no" }), false);
	assert.equal(validDecisionShape({ ...base, notes: [{ file: "a", line: "x", note: "n" }] }), false);
	assert.equal(validDecisionShape({ ...base, skipped: "yes" }), false);
	assert.equal(validDecisionShape(null), false);
});

test("accept-everything sends nothing; skip and edits do", () => {
	const base = { runId: pending.runId, endTree: "d".repeat(40), finalTree: "f".repeat(40), files: [], notes: [], patch: "" };
	assert.equal(needsFollowUp(base), false);
	assert.equal(needsFollowUp({ ...base, skipped: true }), true);
	assert.equal(needsFollowUp({ ...base, files: [{ file: "a.txt", status: "changed" as const }] }), true);
	assert.equal(needsFollowUp({ ...base, notes: [{ file: "a", line: 1, note: "n" }] }), true);
});
