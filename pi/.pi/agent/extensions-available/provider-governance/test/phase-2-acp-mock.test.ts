/** Offline ACP mock-agent transport tests for Phase 2. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { join } from "node:path";

const AGENT = join(import.meta.dirname, "mock-acp-agent.ts");

type JsonObject = Record<string, unknown>;

function startAgent(scenario = "text"): {
  child: ChildProcessWithoutNullStreams;
  next: (predicate: (value: JsonObject) => boolean, timeoutMs?: number) => Promise<JsonObject>;
} {
  const child = spawn(process.execPath, ["--import", "tsx/esm", AGENT], {
    env: { ...process.env, MOCK_ACP_SCENARIO: scenario },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const queue: JsonObject[] = [];
  const waiters: Array<{ predicate: (value: JsonObject) => boolean; resolve: (value: JsonObject) => void; reject: (error: Error) => void }> = [];
  const rl = createInterface({ input: child.stdout });

  rl.on("line", (line) => {
    try {
      const value = JSON.parse(line) as JsonObject;
      const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(value));
      if (waiterIndex >= 0) {
        const waiter = waiters.splice(waiterIndex, 1)[0]!;
        waiter.resolve(value);
      } else {
        queue.push(value);
      }
    } catch { /* mock stderr/invalid output is not a protocol message */ }
  });

  const next = (predicate: (value: JsonObject) => boolean, timeoutMs = 2000): Promise<JsonObject> => {
    const queuedIndex = queue.findIndex(predicate);
    if (queuedIndex >= 0) return Promise.resolve(queue.splice(queuedIndex, 1)[0]!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.resolve === resolve);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("ACP mock response timed out"));
      }, timeoutMs);
      waiters.push({
        predicate,
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject,
      });
    });
  };

  return { child, next };
}

function send(child: ChildProcessWithoutNullStreams, message: JsonObject): void {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function stop(child: ChildProcessWithoutNullStreams): void {
  if (!child.killed) child.kill("SIGTERM");
}

describe("ACP mock agent", () => {
  it("negotiates initialize and creates a session", async () => {
    const agent = startAgent();
    try {
      send(agent.child, { id: 1, method: "initialize", params: {} });
      const initialized = await agent.next((value) => value.id === 1);
      assert.equal((initialized.result as { protocolVersion: number }).protocolVersion, 1);

      send(agent.child, { id: 2, method: "session/new", params: {} });
      const created = await agent.next((value) => value.id === 2);
      assert.equal((created.result as { sessionId: string }).sessionId, "mock-session-1");
    } finally {
      stop(agent.child);
    }
  });

  it("returns end_turn with usage on a normal prompt", async () => {
    const agent = startAgent();
    try {
      send(agent.child, { id: 1, method: "session/new", params: {} });
      await agent.next((value) => value.id === 1);
      send(agent.child, { id: 2, method: "session/prompt", params: { sessionId: "mock-session-1", prompt: "hello" } });
      const update = await agent.next((value) => value.method === "session/update");
      assert.equal((update.params as { stopReason: string }).stopReason, "end_turn");
      const result = await agent.next((value) => value.id === 2);
      assert.equal((result.result as { stopReason: string }).stopReason, "end_turn");
    } finally {
      stop(agent.child);
    }
  });

  it("treats cancel as a notification and confirms through prompt result", async () => {
    const agent = startAgent("cancel");
    try {
      send(agent.child, { id: 1, method: "session/new", params: {} });
      await agent.next((value) => value.id === 1);
      send(agent.child, { id: 2, method: "session/prompt", params: { sessionId: "mock-session-1", prompt: "long task" } });
      send(agent.child, { method: "session/cancel", params: { sessionId: "mock-session-1" } });
      const update = await agent.next((value) => value.method === "session/update");
      assert.equal((update.params as { stopReason: string }).stopReason, "cancelled");
      const result = await agent.next((value) => value.id === 2);
      assert.equal((result.result as { stopReason: string }).stopReason, "cancelled");
    } finally {
      stop(agent.child);
    }
  });

  it("models ambiguous process death without a terminal prompt result", async () => {
    const agent = startAgent("death");
    const exited = new Promise<number | null>((resolve) => agent.child.once("close", resolve));
    send(agent.child, { id: 1, method: "session/new", params: {} });
    await agent.next((value) => value.id === 1);
    send(agent.child, { id: 2, method: "session/prompt", params: { sessionId: "mock-session-1", prompt: "die" } });
    assert.equal(await exited, 17);
    // No result for id=2 is the required fixture for outcome-unknown.
  });
});
