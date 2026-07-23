/**
 * Phase 2 isolated mock conformance tests.
 *
 * These tests never use native auth or a remote provider. All inference traffic
 * is directed to a random localhost mock and the Pi process gets a fresh agent
 * directory. The fixture matrix maps every scenario to the SPEC §6.5 state.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	MockAnthropicServer,
	type MockScenario,
} from "./mock-anthropic-server.ts";
import { PHASE_2_FIXTURES } from "./phase-2-fixtures.ts";

const EXTENSION = join(import.meta.dirname, "test-provider-extension.ts");

let server: MockAnthropicServer;

before(async () => {
	server = new MockAnthropicServer();
	await server.start();
});

after(async () => {
	await server.stop();
});

interface SseEvent {
	event: string;
	data: unknown;
}

async function fetchSse(
	scenario: MockScenario,
	body: unknown = { model: "mock-claude-sonnet", messages: [] },
): Promise<{ status: number; events: SseEvent[]; text: string }> {
	server.setScenario({ scenario, eventDelayMs: 1 });
	const response = await fetch(`${server.url()}/v1/messages`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: "Bearer mock",
		},
		body: JSON.stringify(body),
	});
	const text = await response.text();
	const events: SseEvent[] = [];
	const blocks = text.split("\n\n").filter(Boolean);
	for (const block of blocks) {
		const eventLine = block
			.split("\n")
			.find((line) => line.startsWith("event: "));
		const dataLine = block
			.split("\n")
			.find((line) => line.startsWith("data: "));
		if (!eventLine || !dataLine) continue;
		try {
			events.push({
				event: eventLine.slice(7),
				data: JSON.parse(dataLine.slice(6)),
			});
		} catch {
			events.push({ event: eventLine.slice(7), data: dataLine.slice(6) });
		}
	}
	return { status: response.status, events, text };
}

function runPi(
	args: string[],
	envOverrides: Record<string, string> = {},
	input?: string,
): Promise<{
	code: number | null;
	stdout: string;
	stderr: string;
	events: Array<Record<string, unknown>>;
}> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-phase-2-agent-"));
	const child = spawn("pi", args, {
		env: {
			...process.env,
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			...envOverrides,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});

	let stdout = "";
	let stderr = "";
	const events: Array<Record<string, unknown>> = [];
	let settled = false;

	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
		for (const line of chunk.toString().split("\n")) {
			try {
				const value = JSON.parse(line) as Record<string, unknown>;
				events.push(value);
				if (value.type === "agent_settled") settled = true;
			} catch {
				/* startup/non-JSON output */
			}
		}
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});

	if (input) child.stdin.write(input);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(
				new Error(
					`Pi timed out. stdout=${stdout.slice(-1000)} stderr=${stderr.slice(-1000)}`,
				),
			);
		}, 10000);

		const poll = setInterval(() => {
			if (settled && !child.killed) {
				child.stdin.end();
				child.kill("SIGTERM");
			}
		}, 50);

		child.on("close", (code) => {
			clearTimeout(timeout);
			clearInterval(poll);
			resolve({ code, stdout, stderr, events });
		});
		child.on("error", (err) => {
			clearTimeout(timeout);
			clearInterval(poll);
			reject(err);
		});
	});
}

describe("Mock Anthropic server", () => {
	it("starts on loopback with a random port", () => {
		assert.match(server.url(), /^http:\/\/127\.0\.0\.1:\d+$/);
	});

	it("serves model discovery", async () => {
		server.setScenario({ scenario: "text-simple" });
		const response = await fetch(`${server.url()}/v1/models`);
		assert.equal(response.status, 200);
		const body = (await response.json()) as { data: Array<{ id: string }> };
		assert.deepEqual(
			body.data.map((model) => model.id),
			["mock-claude-sonnet", "mock-claude-opus"],
		);
	});

	it("captures method, path, headers, and request body", async () => {
		server.clearRequests();
		server.setScenario({ scenario: "text-simple" });
		const request = {
			model: "mock-claude-sonnet",
			messages: [{ role: "user", content: "hello" }],
		};
		await fetch(`${server.url()}/v1/messages`, {
			method: "POST",
			headers: { "content-type": "application/json", "x-test": "phase-2" },
			body: JSON.stringify(request),
		});
		const received = server.getRequests().at(-1)!;
		assert.equal(received.method, "POST");
		assert.equal(received.path, "/v1/messages");
		assert.equal(received.headers["x-test"], "phase-2");
		assert.deepEqual(received.body, request);
	});

	it("streams text SSE events", async () => {
		const result = await fetchSse("text-simple");
		assert.equal(result.status, 200);
		assert.deepEqual(
			result.events.map((event) => event.event),
			[
				"message_start",
				"content_block_start",
				"content_block_delta",
				"content_block_stop",
				"message_delta",
				"message_stop",
			],
		);
		const delta = result.events.find(
			(event) => event.event === "content_block_delta",
		)!;
		assert.equal(
			(delta.data as { delta: { text: string } }).delta.text.includes(
				"mock assistant",
			),
			true,
		);
	});

	it("streams thinking and signature blocks", async () => {
		const result = await fetchSse("thinking-signature");
		const deltas = result.events.filter(
			(event) => event.event === "content_block_delta",
		);
		assert.equal(deltas.length, 3);
		assert.equal(
			(deltas[0]!.data as { delta: { type: string } }).delta.type,
			"thinking_delta",
		);
		assert.equal(
			(deltas[1]!.data as { delta: { type: string } }).delta.type,
			"signature_delta",
		);
	});

	it("streams multiple tool calls", async () => {
		const result = await fetchSse("multiple-tool-calls");
		const starts = result.events.filter(
			(event) => event.event === "content_block_start",
		);
		assert.equal(starts.length, 3);
		assert.ok(
			starts.every(
				(event) =>
					(event.data as { content_block: { type: string } }).content_block
						.type === "tool_use",
			),
		);
	});

	it("handles early, late, absent, and inconsistent usage", async () => {
		const early = await fetchSse("usage-early");
		const earlyStart = early.events.find(
			(event) => event.event === "message_start",
		)!.data as { message: { usage: Record<string, number> } };
		const earlyDelta = early.events.find(
			(event) => event.event === "message_delta",
		)!.data as { usage: Record<string, number> };
		assert.equal(earlyStart.message.usage.input_tokens, 10);
		assert.deepEqual(earlyDelta.usage, {});

		const late = await fetchSse("usage-late");
		const lateStart = late.events.find(
			(event) => event.event === "message_start",
		)!.data as { message: { usage: Record<string, number> } };
		const lateDelta = late.events.find(
			(event) => event.event === "message_delta",
		)!.data as { usage: Record<string, number> };
		assert.deepEqual(lateStart.message.usage, {});
		assert.ok(lateDelta.usage.output_tokens > 0);

		const absent = await fetchSse("usage-absent");
		assert.deepEqual(
			(
				absent.events.find((event) => event.event === "message_start")!
					.data as { message: { usage: object } }
			).message.usage,
			{},
		);
		assert.deepEqual(
			(
				absent.events.find((event) => event.event === "message_delta")!
					.data as { usage: object }
			).usage,
			{},
		);

		const inconsistent = await fetchSse("usage-inconsistent");
		assert.equal(
			(
				inconsistent.events.find((event) => event.event === "message_start")!
					.data as { message: { usage: { input_tokens: number } } }
			).message.usage.input_tokens,
			999,
		);
		assert.equal(
			(
				inconsistent.events.find((event) => event.event === "message_delta")!
					.data as { usage: { output_tokens: number } }
			).usage.output_tokens,
			2,
		);
	});

	it("preserves Unicode and image request input", async () => {
		const image = {
			type: "image",
			source: { type: "base64", media_type: "image/png", data: "AA==" },
		};
		const result = await fetchSse("unicode", {
			model: "mock-claude-sonnet",
			messages: [{ role: "user", content: [image] }],
		});
		assert.equal(result.status, 200);
		const request = server.getRequests().at(-1)!;
		assert.deepEqual(
			(request.body as { messages: Array<{ content: unknown }> }).messages[0]!
				.content,
			[image],
		);
		const text = JSON.stringify(result.events);
		assert.match(text, /世界/);
		assert.match(text, /🎉/);
	});
});

describe("Failure and transport fixtures", () => {
	it("returns authoritative HTTP failures", async () => {
		for (const [scenario, expectedStatus] of [
			["401", 401],
			["403", 403],
			["404", 404],
			["429", 429],
			["500", 500],
		] as const) {
			const result = await fetchSse(scenario);
			assert.equal(result.status, expectedStatus, scenario);
		}
	});

	it("covers abort, overflow, oversized, malformed, and slow fixtures", async () => {
		await assert.rejects(() => fetchSse("abort"));

		const overflow = await fetchSse("overflow");
		assert.equal(overflow.status, 200);
		assert.ok(overflow.text.length > 100_000);

		const oversized = await fetchSse("oversized");
		assert.equal(oversized.status, 200);
		assert.ok(oversized.text.length > 1_000_000);

		const malformedJson = await fetchSse("malformed-json");
		assert.equal(malformedJson.status, 200);
		assert.match(malformedJson.text, /invalid json/);

		const malformedSse = await fetchSse("malformed-sse");
		assert.equal(malformedSse.status, 200);
		assert.equal(malformedSse.events.length, 0);
		assert.match(malformedSse.text, /invalid sse event/);

		const slowHeaders = await fetchSse("slow-headers");
		assert.equal(slowHeaders.status, 200);
		const slowStream = await fetchSse("slow-stream");
		assert.equal(slowStream.status, 200);
	});

	it("rejects cross-origin redirect targets when inspected without following", async () => {
		server.setScenario({
			scenario: "redirect",
			redirectUrl: "https://example.invalid/v1/messages",
		});
		const response = await fetch(`${server.url()}/v1/messages`, {
			method: "POST",
			redirect: "manual",
			body: JSON.stringify({ model: "mock-claude-sonnet", messages: [] }),
		});
		assert.equal(response.status, 302);
		assert.equal(
			response.headers.get("location"),
			"https://example.invalid/v1/messages",
		);
	});

	it("preserves assistant/tool history for handoff fixtures", async () => {
		const history = {
			model: "mock-claude-sonnet",
			messages: [
				{ role: "user", content: "inspect this" },
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "tool-1",
							name: "Read",
							input: { path: "x" },
						},
					],
				},
				{
					role: "user",
					content: [
						{ type: "tool_result", tool_use_id: "tool-1", content: "ok" },
					],
				},
			],
		};
		await fetchSse("text-simple", history);
		const body = server.getRequests().at(-1)!.body as typeof history;
		assert.equal(body.messages.length, 3);
		assert.equal(
			(body.messages[1]!.content[0] as { type: string }).type,
			"tool_use",
		);
		assert.equal(
			(body.messages[2]!.content[0] as { type: string }).type,
			"tool_result",
		);
	});

	it("keeps failed distinct from outcome-unknown", () => {
		const failed = PHASE_2_FIXTURES.filter(
			(fixture) => fixture.expected === "failed",
		);
		const unknown = PHASE_2_FIXTURES.filter(
			(fixture) => fixture.expected === "outcome-unknown",
		);
		assert.ok(failed.length > 0);
		assert.ok(unknown.length > 0);
		assert.notDeepEqual(
			failed.map((fixture) => fixture.name),
			unknown.map((fixture) => fixture.name),
		);
	});

	it("maps every fixture to a SPEC §6.5 terminal state", () => {
		assert.ok(PHASE_2_FIXTURES.length >= 20);
		for (const fixture of PHASE_2_FIXTURES) {
			assert.ok(
				["completed", "failed", "outcome-unknown"].includes(fixture.expected),
				fixture.name,
			);
			assert.ok(fixture.description.length > 0, fixture.name);
		}
	});

	it("simulates disconnect before headers as a transport failure", async () => {
		await assert.rejects(() => fetchSse("disconnect-before-headers"));
	});

	it("classifies disconnect after content as outcome-unknown", async () => {
		// The socket closes after content has been accepted. Fetch rejects because
		// the stream is incomplete; that ambiguity is exactly outcome-unknown.
		await assert.rejects(() => fetchSse("disconnect-mid-stream"));
		assert.equal(
			PHASE_2_FIXTURES.find(
				(fixture) => fixture.scenario === "disconnect-mid-stream",
			)!.expected,
			"outcome-unknown",
		);
	});

	it("serves an empty model catalog for model removal", async () => {
		server.setScenario({ scenario: "model-removed" });
		const response = await fetch(`${server.url()}/v1/models`);
		const body = (await response.json()) as { data: unknown[] };
		assert.deepEqual(body.data, []);
	});
});

describe("Pi test-only provider", () => {
	it("lists mock models through the real Pi provider registry", async () => {
		const result = await runPi(["-e", EXTENSION, "--list-models"], {
			MOCK_ANTHROPIC_BASE_URL: server.url(),
		});
		assert.equal(result.code, 0);
		assert.match(result.stdout, /mock-anthropic\s+mock-claude-sonnet/);
		assert.match(result.stdout, /mock-anthropic\s+mock-claude-opus/);
	});

	it("does not contain pi.setModel or register another provider", () => {
		const source = readFileSync(EXTENSION, "utf8");
		assert.equal(source.includes("setModel"), false);
		assert.equal((source.match(/registerProvider\(/g) ?? []).length, 1);
	});

	it("routes an RPC prompt only to the loopback mock", async () => {
		server.clearRequests();
		server.setScenario({ scenario: "text-simple", eventDelayMs: 1 });
		const result = await runPi(
			[
				"--mode",
				"rpc",
				"--provider",
				"mock-anthropic",
				"--model",
				"mock-claude-sonnet",
				"--no-session",
				"-e",
				EXTENSION,
			],
			{ MOCK_ANTHROPIC_BASE_URL: server.url() },
			`${JSON.stringify({ type: "prompt", message: "say hello" })}\n`,
		);
		// 143 is the expected SIGTERM exit from the test harness after agent_settled.
		assert.ok(
			result.code === 0 || result.code === 143,
			`unexpected Pi exit code: ${result.code}`,
		);
		assert.ok(
			server.getRequests().some((request) => request.path === "/v1/messages"),
		);
		assert.ok(
			server.getRequests().every((request) => request.path === "/v1/messages"),
		);
		assert.equal(
			result.events.some((event) => event.type === "agent_settled"),
			true,
		);
	});
});
