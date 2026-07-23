/**
 * Minimal ACP mock agent for offline Phase 2 conformance.
 *
 * JSON-RPC 2.0 over stdin/stdout, one JSON object per line. It models only
 * the client-facing lifecycle needed by the Phase 2 harness:
 * initialize, session/new, session/prompt, session/cancel, and permission.
 *
 * Environment:
 *   MOCK_ACP_SCENARIO=text|permission|cancel|death
 */

import { createInterface } from "node:readline";

interface RpcRequest {
  jsonrpc?: string;
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
}

const scenario = process.env["MOCK_ACP_SCENARIO"] ?? "text";
let cancelled = false;
let sessionId = "mock-session-1";

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
}

function response(id: string | number | undefined, result: unknown): void {
  if (id === undefined) return;
  send({ id, result });
}

function error(id: string | number | undefined, code: number, message: string): void {
  if (id === undefined) return;
  send({ id, error: { code, message } });
}

function update(stopReason?: string, text?: string): void {
  send({
    method: "session/update",
    params: {
      sessionId,
      ...(text ? { content: [{ type: "text", text }] } : {}),
      ...(stopReason ? { stopReason } : {}),
    },
  });
}

async function handle(request: RpcRequest): Promise<void> {
  switch (request.method) {
    case "initialize":
      response(request.id, { protocolVersion: 1, agentInfo: { name: "phase-2-mock-acp" } });
      return;

    case "session/new":
      sessionId = "mock-session-1";
      cancelled = false;
      response(request.id, { sessionId, models: [{ id: "mock-claude-sonnet" }] });
      return;

    case "session/request_permission":
      // The client must answer this request. This fixture only verifies the
      // request/response transport; policy enforcement belongs to Pi.
      send({
        id: request.id ?? "permission-1",
        method: "session/request_permission",
        params: {
          sessionId,
          toolCall: { name: "Read", input: { path: "/tmp/mock" } },
          options: ["allow_once", "deny"],
        },
      });
      return;

    case "session/prompt":
      if (scenario === "death") {
        process.exit(17);
      }
      if (scenario === "permission") {
        update(undefined, "permission requested");
      }
      if (scenario === "cancel") {
        await sleep(20);
        if (cancelled) {
          update("cancelled");
          response(request.id, { stopReason: "cancelled" });
          return;
        }
      }
      await sleep(10);
      if (cancelled) {
        update("cancelled");
        response(request.id, { stopReason: "cancelled" });
      } else {
        update("end_turn", "mock response");
        response(request.id, { stopReason: "end_turn", usage: { inputTokens: 1, outputTokens: 2 } });
      }
      return;

    case "session/cancel":
      cancelled = true;
      // ACP cancellation is a notification in the real route; this mock does
      // not send an acknowledgement. The prompt result is authoritative.
      return;

    default:
      error(request.id, -32601, `method not found: ${request.method}`);
  }
}

const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  try {
    const request = JSON.parse(line) as RpcRequest;
    void handle(request).catch((err: unknown) => {
      process.stderr.write(`[mock-acp-agent] ${String(err)}\n`);
      error(request.id, -32000, "mock handler failed");
    });
  } catch {
    process.stderr.write("[mock-acp-agent] malformed JSON\n");
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
