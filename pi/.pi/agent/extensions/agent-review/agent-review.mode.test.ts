// The mode gate, end to end across both components.
//
// The planner's contract tests never write a mode file, so they only ever
// exercise the default (missing file means on). This file covers the other
// half: `scripts/agent-review mode off` must actually stop the gate. That is
// the escape hatch — if the CLI and the extension ever disagree about the
// file's name or shape, reviews cannot be turned off, and nothing else fails
// loudly enough to notice.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { after } from "node:test";
import agentReview from "./index.ts";

const cli = join(dirname(new URL(import.meta.url).pathname), "../../../../../scripts/agent-review");
const dirs: string[] = [];
const sessions: Array<() => Promise<unknown>> = [];
after(async () => {
  for (const close of sessions) await close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-review-mode-")));
  dirs.push(root);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  writeFileSync(join(root, "tracked.txt"), "base\n");
  git("add", "-A");
  git("commit", "-qm", "base");
  return root;
}

function start(root: string) {
  const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
  const commands = new Map<string, (args: string, c: unknown) => Promise<void>>();
  const notices: string[] = [];
  const channels = new Map<string, Array<(data: unknown) => void>>();
  const ctx = { cwd: root, hasUI: true, mode: "tui", ui: { notify: (m: string) => notices.push(m), setStatus: () => {} } };
  const pi = {
    on: (name: string, handler: (e: unknown, c: unknown) => unknown) =>
      handlers.set(name, [...(handlers.get(name) ?? []), handler]),
    registerCommand: (name: string, options: { handler: (args: string, c: unknown) => Promise<void> }) =>
      commands.set(name, options.handler),
    events: {
      on: (channel: string, handler: (data: unknown) => void) => {
        channels.set(channel, [...(channels.get(channel) ?? []), handler]);
        return () => {};
      },
      emit: (channel: string, data: unknown) => channels.get(channel)?.forEach((handler) => handler(data)),
    },
    sendUserMessage: () => {},
  };
  agentReview(pi as never);
  const emit = async (name: string, payload: Record<string, unknown> = {}) => {
    let result: unknown;
    for (const handler of handlers.get(name) ?? []) result = (await handler({ type: name, ...payload }, ctx)) ?? result;
    return result;
  };
  sessions.push(() => emit("session_shutdown"));
  // A run ends at agent_settled followed by the verifier's settled signal;
  // without the second half the extension waits out its 30s fallback instead.
  const settle = async () => {
    await emit("agent_settled");
    pi.events.emit("post-run-verifier:settled", {});
  };
  const command = (name: string, args: string) => commands.get(name)!(args, ctx);
  return { emit, settle, command, notices };
}

const pending = (root: string) => {
  try {
    return readdirSync(join(root, ".pi", "agent-review", "pending"));
  } catch {
    return [];
  }
};

test("the CLI writes the mode file the extension reads", async () => {
  const root = makeRepo();
  execFileSync(cli, ["mode", "off"], { cwd: root, encoding: "utf8" });
  const file = join(root, ".pi", "agent-review", "mode.json");
  assert.ok(existsSync(file), "CLI and extension disagree about the mode file's path");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).mode, "off");
});

test("with mode off, a changing run produces no pending review", async () => {
  const root = makeRepo();
  execFileSync(cli, ["mode", "off"], { cwd: root, encoding: "utf8" });
  const { emit, settle } = start(root);
  await emit("session_start");
  assert.deepEqual(await emit("input", { text: "do the work", source: "interactive" }), { action: "continue" });
  await emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), "agent edit\n");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 400));
  assert.deepEqual(pending(root), []);
});

test("switching the mode back on restores the gate", async () => {
  const root = makeRepo();
  execFileSync(cli, ["mode", "off"], { cwd: root, encoding: "utf8" });
  execFileSync(cli, ["mode", "on"], { cwd: root, encoding: "utf8" });
  const { emit, settle } = start(root);
  await emit("session_start");
  await emit("input", { text: "do the work", source: "interactive" });
  await emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), "agent edit\n");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  assert.equal(pending(root).length, 1);
});

// ─── Interrupted reviews ─────────────────────────────────────────────────────
//
// A review is claimed by renaming pending/<id>.json to <id>.processing. If Pi
// dies between that rename and the end of processing, the .processing file is
// left behind and nothing ever looks at it again: the review is neither
// pending nor complete. The gate must not quietly disappear in that state.

async function interruptedReview(root: string): Promise<string> {
  const { emit, settle } = start(root);
  await emit("session_start");
  await emit("input", { text: "do the work", source: "interactive" });
  await emit("agent_start");
  writeFileSync(join(root, "tracked.txt"), "agent edit\n");
  await settle();
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const [name] = pending(root);
  const id = name.slice(0, -".json".length);
  // The crash: claimed, then the process died before it could finish.
  renameSync(join(root, ".pi", "agent-review", "pending", name), join(root, ".pi", "agent-review", "pending", `${id}.processing`));
  return id;
}

test("an interrupted review still blocks input", async () => {
  const root = makeRepo();
  const id = await interruptedReview(root);
  const next = start(root);
  await next.emit("session_start");
  assert.deepEqual(await next.emit("input", { text: "carry on", source: "interactive" }), { action: "handled" });
  assert.ok(next.notices.some((notice) => notice.includes(id)), `no notice named the review: ${JSON.stringify(next.notices)}`);
});

test("/review skip clears an interrupted review", async () => {
  const root = makeRepo();
  const id = await interruptedReview(root);
  const next = start(root);
  await next.emit("session_start");
  await next.command("review", `skip ${id}`);
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.deepEqual(pending(root), [], "the interrupted review was not cleared");
  assert.deepEqual(await next.emit("input", { text: "carry on", source: "interactive" }), { action: "continue" });
});
