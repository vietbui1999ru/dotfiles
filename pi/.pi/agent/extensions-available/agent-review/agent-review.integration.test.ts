// Contract tests for agent-review v1 (docs/workflows/agent-review.md).
// Written by the planner. The implementer must not edit this file; if a test looks wrong,
// stop and report it. Tests drive the real extension through a fake Pi and real git repos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import agentReview from "./index.ts";

const tempDirs: string[] = [];
after(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}

function git(root: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
}

function makeRepo(): string {
  const root = tempDir("agent-review-it-");
  git(root, ["init", "-q"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "test"]);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  git(root, ["add", "-A"]);
  git(root, ["commit", "-qm", "base"]);
  return root;
}

// Computed independently of the extension, following the spec's snapshot rule.
function treeOf(root: string): string {
  const env = { ...process.env, GIT_INDEX_FILE: join(tempDir("agent-review-idx-"), "index") };
  git(root, ["add", "-A", "--", ".", ":(exclude).pi/agent-review"], env);
  return git(root, ["write-tree"], env);
}

const reviewPath = (root: string, ...parts: string[]) => join(root, ".pi", "agent-review", ...parts);

function pendingIds(root: string): string[] {
  try {
    return readdirSync(reviewPath(root, "pending"))
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

function writeDecision(root: string, decision: Record<string, unknown>): void {
  const dir = reviewPath(root, "decisions");
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `${decision.runId}.json.tmp`);
  writeFileSync(tmp, JSON.stringify(decision));
  renameSync(tmp, join(dir, `${decision.runId}.json`));
}

async function waitFor(check: () => boolean, ms = 5_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
