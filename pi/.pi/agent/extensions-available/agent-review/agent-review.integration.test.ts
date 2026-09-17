// Contract tests for agent-review v1 (docs/workflows/agent-review.md).
// Written by the planner. The implementer must not edit this file; if a test looks wrong,
// stop and report it. Tests drive the real extension through a fake Pi and real git repos.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import agentReview from "./index.ts";

const tempDirs: string[] = [];
const openSessions: Array<{ close: () => Promise<unknown> }> = [];
after(async () => {
  // Close sessions first: an open fs.watch would keep the test process alive.
  for (const session of openSessions) await session.close();
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Handler = (event: Record<string, unknown>, ctx: unknown) => unknown;

// Minimal fake of Pi's ExtensionAPI: only what the spec's lifecycle needs.
function startSession(root: string) {
  const handlers = new Map<string, Handler[]>();
  const commands = new Map<string, (args: string, ctx: unknown) => Promise<void>>();
  const channels = new Map<string, Array<(data: unknown) => void>>();
  const sent: string[] = [];
  const notices: string[] = [];
  const ctx = {
    cwd: root,
    hasUI: true,
    mode: "tui",
    ui: { notify: (message: string) => notices.push(message), setStatus: () => {} },
  };
  const pi = {
    on: (name: string, handler: Handler) => handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, options: { handler: (args: string, c: unknown) => Promise<void> }) =>
      commands.set(name, options.handler),
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        channels.set(channel, [...(channels.get(channel) ?? []), handler]);
        return () => {};
      },
      emit: (channel: string, data: unknown) => channels.get(channel)?.forEach((handler) => handler(data)),
    },
    sendUserMessage: (text: string) => {
      sent.push(text);
    },
  };
  agentReview(pi as never);

  async function emit(name: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    let result: unknown;
    for (const handler of handlers.get(name) ?? []) {
      result = (await handler({ type: name, ...payload }, ctx)) ?? result;
    }
    return result;
  }

  const session = {
    sent,
    notices,
    emit,
    input: (text: string, source = "interactive") => emit("input", { text, source }),
    command: (name: string, args: string) => commands.get(name)!(args, ctx),
    // Spec: a run ends at agent_settled followed by the verifier's settled signal.
    finishRun: async () => {
      await emit("agent_settled");
      pi.events.emit("post-run-verifier:settled", {});
    },
    close: () => emit("session_shutdown"),
  };
  openSessions.push(session);
  return session;
}

type Session = ReturnType<typeof startSession>;
type PendingRecord = { runId: string; baseTree: string; endTree: string; files: Array<{ file: string }> };

function readPending(root: string, runId: string): PendingRecord {
  return JSON.parse(readFileSync(reviewPath(root, "pending", `${runId}.json`), "utf8"));
}

const reviewRefs = (root: string) => git(root, ["for-each-ref", "refs/agent-review"]);

async function newSession(): Promise<{ root: string; session: Session }> {
  const root = makeRepo();
  const session = startSession(root);
  await session.emit("session_start");
  return { root, session };
}

// One human-started run that edits tracked.txt; returns its pending record.
async function changingRun(root: string, session: Session, content = "agent edit\n"): Promise<PendingRecord> {
  assert.deepEqual(await session.input("do the work"), { action: "continue" });
  await session.emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), content);
  await session.finishRun();
  await waitFor(() => pendingIds(root).length === 1);
  return readPending(root, pendingIds(root)[0]);
}

function decide(root: string, pending: PendingRecord, extra: Record<string, unknown> = {}): void {
  const finalTree = treeOf(root);
  writeDecision(root, {
    runId: pending.runId,
    endTree: pending.endTree,
    finalTree,
    files: [],
    notes: [],
    patch: git(root, ["diff", pending.endTree, finalTree]),
    ...extra,
  });
}

// ─── Core gate ───────────────────────────────────────────────────────────────

test("a run that changes nothing leaves no pending review and no refs", async () => {
  const { root, session } = await newSession();
  assert.deepEqual(await session.input("look around"), { action: "continue" });
  await session.emit("agent_start");
  await session.finishRun();
  await sleep(400);
  assert.deepEqual(pendingIds(root), []);
  assert.equal(reviewRefs(root), "");
});

test("a changing run writes one well-formed pending record matching the working tree", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  assert.match(pending.runId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.match(pending.baseTree, /^[0-9a-f]{40}$/);
  assert.equal(pending.endTree, treeOf(root));
  assert.notEqual(pending.baseTree, pending.endTree);
  assert.ok(pending.files.some((entry) => entry.file === "tracked.txt"));
});

test("while a review is pending, human and extension input are both blocked", async () => {
  const { root, session } = await newSession();
  await changingRun(root, session);
  assert.deepEqual(await session.input("next task"), { action: "handled" });
  assert.deepEqual(await session.input("repair", "extension"), { action: "handled" });
});

test("a decision with reviewer changes sends exactly one follow-up and clears the review", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  writeFileSync(join(root, "tracked.txt"), "base\n"); // reviewer rejects the agent's change
  decide(root, pending);
  await waitFor(() => session.sent.length === 1 && pendingIds(root).length === 0);
  await sleep(400);
  assert.equal(session.sent.length, 1);
  assert.ok(session.sent[0].includes(`.pi/agent-review/decisions/${pending.runId}.json`));
  assert.equal(reviewRefs(root), "");
  assert.deepEqual(await session.input("carry on"), { action: "continue" });
});

test("accepting everything with no notes sends nothing and clears the review", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  decide(root, pending);
  await waitFor(() => pendingIds(root).length === 0);
  await sleep(400);
  assert.equal(session.sent.length, 0);
});

test("a decision with a forged endTree is ignored and the review stays pending", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  decide(root, pending, { endTree: "0".repeat(40) });
  await sleep(600);
  assert.deepEqual(pendingIds(root), [pending.runId]);
  assert.equal(session.sent.length, 0);
  assert.ok(session.notices.length > 0, "a warning should be shown");
});

test("/review skip clears a pending review with one follow-up", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  await session.command("review", `skip ${pending.runId}`);
  await waitFor(() => pendingIds(root).length === 0);
  await sleep(400);
  assert.equal(session.sent.length, 1);
  assert.deepEqual(await session.input("carry on"), { action: "continue" });
});

test("the agent's response to a review follow-up is itself reviewed", async () => {
  const { root, session } = await newSession();
  const pending = await changingRun(root, session);
  writeFileSync(join(root, "tracked.txt"), "base\n");
  decide(root, pending);
  await waitFor(() => session.sent.length === 1 && pendingIds(root).length === 0);
  // Pi delivers the follow-up as extension-sourced input; the agent then edits again.
  assert.deepEqual(await session.input(session.sent[0], "extension"), { action: "continue" });
  await session.emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), "agent retry\n");
  await session.finishRun();
  await waitFor(() => pendingIds(root).length === 1);
  assert.notEqual(pendingIds(root)[0], pending.runId);
});
