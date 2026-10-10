// `agent-review approve <runId>`, end to end against a real pending review.
//
// A refusal is exercised through the plain CLI. A successful approval needs the
// confirmation dialog, which only a person can click, so those cases load the
// CLI as a Python module and replace `confirm`. The CLI itself has no bypass.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import agentReview, { needsFollowUp, validDecisionShape } from "./index.ts";

const cli = join(dirname(new URL(import.meta.url).pathname), "../../../../../scripts/agent-review");
const dirs: string[] = [];
const sessions: Array<() => Promise<unknown>> = [];
after(async () => {
  for (const close of sessions) await close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8" });

function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-approve-")));
  dirs.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "test");
  writeFileSync(join(root, "tracked.txt"), "base\n");
  writeFileSync(join(root, ".gitignore"), "/.pi/agent-review/\nignored.txt\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "base");
  return root;
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
    for (const h of handlers.get(name) ?? []) await h({ type: name, ...payload }, ctx);
  };
  sessions.push(() => emit("session_shutdown"));
  const settle = async () => {
    await emit("agent_settled");
    pi.events.emit("post-run-verifier:settled", {});
  };
  return { emit, settle, sent };
}

const dirOf = (root: string) => join(root, ".pi", "agent-review");
const list = (path: string) => (existsSync(path) ? readdirSync(path) : []);

async function pendingRun(root: string): Promise<string> {
  const { emit, settle } = start(root);
  await emit("session_start");
  await emit("input", { text: "work", source: "interactive" });
  await emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), "agent edit\n");
  await settle();
  for (let i = 0; i < 100; i++) {
    const found = list(join(dirOf(root), "pending")).find((name) => name.endsWith(".json"));
    if (found) return found.slice(0, -5);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("no pending review appeared");
}

type Out = { status: number | null; stdout: string; stderr: string; json: Record<string, unknown> };
const parse = (r: { status: number | null; stdout: string; stderr: string }): Out => {
  assert.equal(r.stderr, "", "approve must never write to stderr");
  const lines = r.stdout.trimEnd().split("\n");
  assert.equal(lines.length, 1, `expected exactly one JSON line, got: ${r.stdout}`);
  return { ...r, json: JSON.parse(lines[0]) };
};

const refuse = (cwd: string, id: string) =>
  parse(spawnSync(cli, ["approve", id], { cwd, encoding: "utf8" }));

// Load the CLI as a module so `confirm` can be replaced; the CLI never reads
// an environment variable that could do the same for an agent.
const approveWith = (cwd: string, id: string, ok: boolean) =>
  parse(spawnSync("python3", ["-I", "-c", `
import importlib.machinery, importlib.util, sys
loader = importlib.machinery.SourceFileLoader("agent_review", sys.argv[1])
m = importlib.util.module_from_spec(importlib.util.spec_from_loader("agent_review", loader))
loader.exec_module(m)
m.confirm = lambda *a: ${ok ? "True" : "False"}
sys.argv = ["agent-review", "approve", sys.argv[2]]
raise SystemExit(m.main())
`, cli, id], { cwd, encoding: "utf8" }));

const decisionOf = (root: string, id: string) => JSON.parse(readFileSync(join(dirOf(root), "decisions", `${id}.json`), "utf8"));

test("a clean tree approves with a decision Pi accepts without a follow-up", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  const out = approveWith(root, id, true);
  assert.equal(out.status, 0);
  assert.deepEqual(out.json, { ok: true, runId: id });
  const decision = decisionOf(root, id);
  assert.ok(validDecisionShape(decision));
  assert.ok(!needsFollowUp(decision));
  assert.equal(decision.skipped, undefined);
  assert.equal(decision.finalTree, decision.endTree);
  assert.ok(decision.files.length > 0 && decision.files.every((f: { status: string }) => f.status === "accepted"));
});

test("approve consumes the pending record and refs, so a new session sends nothing", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  approveWith(root, id, true);
  assert.deepEqual(list(join(dirOf(root), "pending")), []);
  assert.equal(git(root, "for-each-ref", `refs/agent-review/${id}`).trim(), "");
  const next = start(root);
  await next.emit("session_start");
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.deepEqual(next.sent, []);
});

test("a tracked edit after the run is tree-changed and writes nothing", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  writeFileSync(join(root, "tracked.txt"), "edited later\n");
  const out = approveWith(root, id, true);
  assert.equal(out.json.reason, "tree-changed");
  assert.equal(out.status, 2);
  assert.deepEqual(list(join(dirOf(root), "decisions")), []);
});

test("an untracked, unignored file added after the run is tree-changed", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  writeFileSync(join(root, "new.txt"), "x\n");
  assert.equal(approveWith(root, id, true).json.reason, "tree-changed");
});

test("ignored files and Pi's own .pi state do not block approval", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  writeFileSync(join(root, "ignored.txt"), "x\n");
  mkdirSync(join(root, ".pi", "status"), { recursive: true });
  writeFileSync(join(root, ".pi", "status", "x.json"), "{}\n");
  assert.equal(approveWith(root, id, true).json.ok, true);
});

test("a linked worktree approves its own run; the main checkout does not see it", async () => {
  const main = makeRepo();
  const linked = join(main, "..", `linked-${Date.now()}`);
  git(main, "worktree", "add", "-q", "-b", "wt", linked);
  dirs.push(linked);
  const id = await pendingRun(realpathSync(linked));
  assert.equal(refuse(main, id).json.reason, "no-pending");
  assert.equal(approveWith(realpathSync(linked), id, true).json.ok, true);
});

test("running from a subdirectory works", async () => {
  const root = makeRepo();
  mkdirSync(join(root, "sub"));
  const id = await pendingRun(root);
  assert.equal(approveWith(join(root, "sub"), id, true).json.ok, true);
});

test("malformed ids are invalid-id; an uppercase uuid is accepted", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  for (const bad of ["not-a-uuid", "../../x", `${id}\n`]) assert.equal(refuse(root, bad).json.reason, "invalid-id");
  // Valid shape, but never the stored id: no-pending on a case-sensitive disk,
  // invalid-pending on macOS. Either way it must not approve.
  const upper = approveWith(root, id.toUpperCase(), true).json;
  assert.equal(upper.ok, false);
  assert.notEqual(upper.reason, "invalid-id");
});

test("no pending record is no-pending", () => {
  assert.equal(refuse(makeRepo(), "11111111-1111-4111-8111-111111111111").json.reason, "no-pending");
});

// Corrupt a real pending record in place, then approve against the clean tree.
async function withPending(edit: (file: string, id: string) => void) {
  const root = makeRepo();
  const id = await pendingRun(root);
  edit(join(dirOf(root), "pending", `${id}.json`), id);
  return { root, id };
}
const patch = (file: string, fields: Record<string, unknown>) =>
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), ...fields }));

test("a .processing claim is processing", async () => {
  const { root, id } = await withPending((file) => writeFileSync(file.replace(/\.json$/, ".processing"), "{}"));
  assert.equal(refuse(root, id).json.reason, "processing");
});

test("an error record is snapshot-failed, before the tree check", async () => {
  const { root, id } = await withPending((file) => patch(file, { error: "boom" }));
  assert.equal(refuse(root, id).json.reason, "snapshot-failed");
});

test("a tamper record is tampered", async () => {
  const { root, id } = await withPending((file) => patch(file, { tamper: true }));
  assert.equal(refuse(root, id).json.reason, "tampered");
});

test("an existing decision is already-decided and stays untouched", async () => {
  const { root, id } = await withPending(() => {});
  const decisions = join(dirOf(root), "decisions");
  mkdirSync(decisions, { recursive: true });
  writeFileSync(join(decisions, `${id}.json`), "mine\n");
  assert.equal(refuse(root, id).json.reason, "already-decided");
  assert.equal(readFileSync(join(decisions, `${id}.json`), "utf8"), "mine\n");
});

test("an id that differs from the record is invalid-pending", async () => {
  const { root, id } = await withPending((file) => patch(file, { runId: "22222222-2222-4222-8222-222222222222" }));
  assert.equal(refuse(root, id).json.reason, "invalid-pending");
});

test("outside a git repository: exit 2, one JSON line, empty stderr", () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-norepo-")));
  dirs.push(dir);
  const out = refuse(dir, "11111111-1111-4111-8111-111111111111");
  assert.equal(out.status, 2);
  assert.equal(out.json.reason, "error");
});

test("a declined dialog is not-confirmed and leaves the pending record intact", async () => {
  const root = makeRepo();
  const id = await pendingRun(root);
  const out = approveWith(root, id, false);
  assert.equal(out.json.reason, "not-confirmed");
  assert.deepEqual(list(join(dirOf(root), "decisions")), []);
  assert.deepEqual(list(join(dirOf(root), "pending")), [`${id}.json`]);
});
