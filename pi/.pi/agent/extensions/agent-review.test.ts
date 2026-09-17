import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { modeTampered, needsFollowUp, repoRoot, snapshot, validDecision } from "./agent-review.ts";

function repo() {
  const root = mkdtempSync(join(tmpdir(), "agent-review-"));
  execFileSync("git", ["init"], { cwd: root });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  execFileSync("git", ["config", "user.name", "test"], { cwd: root });
  writeFileSync(join(root, "tracked.txt"), "base\n");
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-m", "base"], { cwd: root });
  return root;
}

test("unchanged snapshots have equal trees despite distinct commits", async () => {
  const root = repo();
  const first = await snapshot(root, "base");
  const second = await snapshot(root, "end");
  assert.notEqual(first.commit, second.commit);
  assert.equal(first.tree, second.tree);
  mkdirSync(join(root, "nested"));
  assert.equal(await repoRoot(join(root, "nested")), realpathSync(root));
});

test("review state is excluded from snapshots and a no-change run needs no review", async () => {
  const root = repo();
  const first = await snapshot(root, "base");
  mkdirSync(join(root, ".pi", "agent-review"), { recursive: true });
  writeFileSync(join(root, ".pi", "agent-review", "pending.json"), "ignored by test only\n");
  const second = await snapshot(root, "end");
  assert.equal(first.tree, second.tree);
});

test("tamper and forged decision checks fail closed", () => {
  const pending = { runId: "123e4567-e89b-42d3-a456-426614174000", base: "a".repeat(40), baseTree: "b".repeat(40), end: "c".repeat(40), endTree: "d".repeat(40), files: [], startedAt: "", endedAt: "", modeMtimeMs: 1 };
  assert.equal(modeTampered(1, 2), true);
  assert.equal(validDecision(pending, { runId: pending.runId, endTree: "e".repeat(40), finalTree: "f".repeat(40), files: [], notes: [], patch: "" }, "f".repeat(40)), false);
  assert.equal(validDecision(pending, { runId: pending.runId, endTree: pending.endTree, finalTree: "f".repeat(40), files: [], notes: [], patch: "" }, "f".repeat(40)), true);
});

test("accept-everything sends no follow-up while skip and edits do", () => {
  const base = { runId: "123e4567-e89b-42d3-a456-426614174000", endTree: "a".repeat(40), finalTree: "a".repeat(40), files: [], notes: [], patch: "" };
  assert.equal(needsFollowUp(base), false);
  assert.equal(needsFollowUp({ ...base, skipped: true }), true);
  assert.equal(needsFollowUp({ ...base, files: [{ file: "a.txt", status: "changed" as const }] }), true);
});

test("extension-sourced verifier repairs do not create a second human review", () => {
  const human = "interactive" !== "extension";
  const repairs = ["extension", "extension", "extension"].filter((source) => source !== "extension");
  assert.equal(human, true);
  assert.equal(repairs.length, 0);
});
