/**
 * Mock Anthropic-compatible server for Pi conformance testing.
 *
 * Listens on localhost:0 (random port), speaks the Anthropic Messages
 * SSE streaming protocol. Controlled via scenario config to simulate
 * success, failure, edge cases, and transport errors.
 *
 * Usage:
 *   const server = new MockAnthropicServer();
 *   await server.start();
 *   // ... use server.url() to point Pi at it ...
 *   await server.stop();
 *   const requests = server.getRequests(); // all received POST bodies
 */

import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";

// ───── Scenario types ─────

export type MockScenario =
	| "text-simple"
	| "text-multiline"
	| "thinking"
	| "thinking-signature"
	| "tool-calls"
	| "multiple-tool-calls"
	| "abort"
	| "overflow"
	| "oversized"
	| "unicode"
	| "images"
	| "usage-early"
	| "usage-late"
	| "usage-absent"
	| "usage-inconsistent"
	| "401"
	| "403"
	| "404"
	| "429"
	| "500"
	| "malformed-json"
	| "malformed-sse"
	| "disconnect-before-headers"
	| "disconnect-mid-stream"
	| "slow-headers"
	| "slow-stream"
	| "redirect"
	| "model-removed";

export interface MockScenarioConfig {
	scenario: MockScenario;
	/** Delay before sending headers (ms). Default 0. */
	headerDelayMs?: number;
	/** Delay between SSE events (ms). Default 10. */
	eventDelayMs?: number;
	/** Abort mid-stream after this many events. 0 = no abort. */
	abortAfterEvents?: number;
	/** Respond with a redirect (302) to this URL. */
	redirectUrl?: string;
	/** Model name to report in message_start. */
	modelName?: string;
	/** Custom error message for error scenarios. */
	errorMessage?: string;
}

// ───── Server ─────

export class MockAnthropicServer {
	private server = createServer();
	private _port = 0;
	private receivedRequests: Array<{
		method: string;
		path: string;
		headers: Record<string, string>;
		body: unknown;
	}> = [];
	private currentConfig: MockScenarioConfig = { scenario: "text-simple" };

	/** Start the server on a random port. Resolves once listening. */
	start(): Promise<void> {
		return new Promise((resolve) => {
			this.server.on("request", (req, res) => this.handleRequest(req, res));
			this.server.listen(0, "127.0.0.1", () => {
				this._port = (this.server.address() as AddressInfo).port;
				resolve();
			});
		});
	}

	/** Stop the server. */
	stop(): Promise<void> {
		return new Promise((resolve) => {
			this.server.close(() => resolve());
		});
	}

	/** Base URL for Pi to connect to. */
	url(): string {
		return `http://127.0.0.1:${this._port}`;
	}

	/** Set the current scenario to simulate. */
	setScenario(config: MockScenarioConfig): void {
		this.currentConfig = config;
	}

	/** Get all received request bodies. */
	getRequests(): Array<{
		method: string;
		path: string;
		headers: Record<string, string>;
		body: unknown;
	}> {
		return this.receivedRequests;
	}

	/** Clear received requests log. */
	clearRequests(): void {
		this.receivedRequests = [];
	}

	// ───── Request handler ─────

	private handleRequest(req: IncomingMessage, res: ServerResponse): void {
		const method = req.method ?? "GET";
		const path = req.url ?? "/";
		const headers: Record<string, string> = {};
		for (const [k, v] of Object.entries(req.headers)) {
			if (v) headers[k] = Array.isArray(v) ? v.join(", ") : v;
		}

		// Collect body for POST
		const chunks: Buffer[] = [];
		req.on("data", (chunk: Buffer) => chunks.push(chunk));
		req.on("end", () => {
			const rawBody = Buffer.concat(chunks).toString("utf8");
			let body: unknown = rawBody;
			try {
				body = JSON.parse(rawBody);
			} catch {
				/* keep as string */
			}

			this.receivedRequests.push({ method, path, headers, body });

			const cfg = this.currentConfig;

			// Handle redirect scenario
			if (cfg.scenario === "redirect" && cfg.redirectUrl) {
				res.writeHead(302, { Location: cfg.redirectUrl });
				res.end();
				return;
			}

			// Handle error status codes
			if (cfg.scenario === "401") {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "authentication_error",
							message: cfg.errorMessage ?? "unauthorized",
						},
					}),
				);
				return;
			}
			if (cfg.scenario === "403") {
				res.writeHead(403, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "permission_error",
							message: cfg.errorMessage ?? "forbidden",
						},
					}),
				);
				return;
			}
			if (cfg.scenario === "404") {
				res.writeHead(404, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "not_found_error",
							message: cfg.errorMessage ?? "model not found",
						},
					}),
				);
				return;
			}
			if (cfg.scenario === "429") {
				res.writeHead(429, {
					"Content-Type": "application/json",
					"Retry-After": "5",
				});
				res.end(
					JSON.stringify({
						error: {
							type: "rate_limit_error",
							message: cfg.errorMessage ?? "rate limited",
						},
					}),
				);
				return;
			}
			if (cfg.scenario === "500") {
				res.writeHead(500, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						error: {
							type: "server_error",
							message: cfg.errorMessage ?? "internal error",
						},
					}),
				);
				return;
			}

			// Handle model-removed scenario — return empty list
			if (
				cfg.scenario === "model-removed" &&
				method === "GET" &&
				path === "/v1/models"
			) {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(JSON.stringify({ data: [] }));
				return;
			}

			// Handle model discovery
			if (method === "GET" && path === "/v1/models") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(
					JSON.stringify({
						data: [
							{
								id: "mock-claude-sonnet",
								name: "Mock Claude Sonnet",
								context_window: 200000,
								max_tokens: 64000,
							},
							{
								id: "mock-claude-opus",
								name: "Mock Claude Opus",
								context_window: 200000,
								max_tokens: 64000,
								reasoning: true,
							},
						],
					}),
				);
				return;
			}

			// Handle malformed scenarios
			if (cfg.scenario === "malformed-json") {
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end("{invalid json content");
				return;
			}

			if (cfg.scenario === "malformed-sse") {
				this.writeSseHeader(res, cfg);
				res.write("data: {invalid sse event\n\n");
				res.end();
				return;
			}

			if (cfg.scenario === "disconnect-before-headers") {
				// Close the socket without sending headers
				req.socket.destroy();
				return;
			}

			// All other scenarios: stream a response
			this.streamResponse(req, res, cfg);
		});
	}

	// ───── SSE streaming ─────

	private async streamResponse(
		req: IncomingMessage,
		res: ServerResponse,
		cfg: MockScenarioConfig,
	): Promise<void> {
		const hd = cfg.headerDelayMs ?? 0;
		const ed = cfg.eventDelayMs ?? 10;
		const abortAfter =
			cfg.abortAfterEvents ?? (cfg.scenario === "abort" ? 1 : 0);

		// Header delay
		if (hd > 0) await sleep(hd);

		// Handle slow-headers: delay is already done above
		if (cfg.scenario === "slow-headers") {
			// A default delay keeps this fixture meaningful without extra config.
			if (hd === 0) await sleep(250);
		}

		// Handle disconnect-mid-stream for empty-scenario
		if (cfg.scenario === "disconnect-mid-stream") {
			this.writeSseHeader(res, cfg);
			await sleep(50);
			const events = this.buildEvents(cfg);
			for (let i = 0; i < Math.min(events.length, 2); i++) {
				res.write(events[i]);
				await sleep(ed);
			}
			req.socket.destroy();
			return;
		}

		// Handle slow-stream
		if (cfg.scenario === "slow-stream") {
			this.writeSseHeader(res, cfg);
			const events = this.buildEvents(cfg);
			for (const event of events) {
				res.write(event);
				await sleep(ed * 10); // 10x delay
			}
			res.end();
			return;
		}

		// Normal scenario: write all events
		this.writeSseHeader(res, cfg);
		const events = this.buildEvents(cfg);

		for (let i = 0; i < events.length; i++) {
			res.write(events[i]);
			if (abortAfter > 0 && i + 1 >= abortAfter) {
				req.socket.destroy();
				return;
			}
			await sleep(ed);
		}

		res.end();
	}

	private writeSseHeader(res: ServerResponse, _cfg: MockScenarioConfig): void {
		res.writeHead(200, {
			"Content-Type": "text/event-stream",
			"Cache-Control": "no-cache",
			Connection: "keep-alive",
		});
	}

	private buildEvents(cfg: MockScenarioConfig): string[] {
		const modelName = cfg.modelName ?? "mock-claude-sonnet";
		const events: string[] = [];

		switch (cfg.scenario) {
			case "text-simple":
				events.push(
					...this.textEvents(
						modelName,
						"Hello! I'm the mock assistant. How can I help you?",
					),
				);
				break;

			case "text-multiline":
				events.push(...this.textEvents(modelName, "Line 1\nLine 2\nLine 3"));
				break;

			case "unicode":
				events.push(
					...this.textEvents(modelName, "Hello 世界! ñ ñ ñ émoji: 🎉🔥🚀"),
				);
				break;

			case "thinking":
				events.push(
					...this.thinkingEvents(
						modelName,
						"Let me think about this...",
						"The answer is 42.",
					),
				);
				break;

			case "thinking-signature":
				events.push(
					...this.thinkingEvents(
						modelName,
						"Thinking step by step...",
						"Final result.",
						"sig_abc123",
					),
				);
				break;

			case "tool-calls":
				events.push(
					...this.toolCallEvents(modelName, [
						{ id: "tu_001", name: "bash", args: { command: "ls -la" } },
					]),
				);
				break;

			case "multiple-tool-calls":
				events.push(
					...this.toolCallEvents(modelName, [
						{ id: "tu_001", name: "bash", args: { command: "ls" } },
						{
							id: "tu_002",
							name: "Read",
							args: { file_path: "/tmp/test.txt" },
						},
						{
							id: "tu_003",
							name: "Grep",
							args: { pattern: "TODO", include: "*.ts" },
						},
					]),
				);
				break;

			case "abort":
				// Send only message_start then abort
				events.push(
					this.sse("message_start", {
						type: "message_start",
						message: {
							id: "msg_abort",
							type: "message",
							role: "assistant",
							content: [],
							model: modelName,
							stop_reason: null,
							usage: { input_tokens: 5, output_tokens: 0 },
						},
					}),
				);
				break;

			case "usage-early":
				events.push(
					...this.textEvents(modelName, "Usage reported early.", "early"),
				);
				break;

			case "usage-late":
				events.push(
					...this.textEvents(modelName, "Usage reported late.", "late"),
				);
				break;

			case "usage-absent":
				events.push(...this.textEvents(modelName, "Usage absent.", "absent"));
				break;

			case "usage-inconsistent":
				events.push(
					...this.textEvents(modelName, "Usage inconsistent.", "inconsistent"),
				);
				break;

			case "overflow":
				events.push(...this.textEvents(modelName, "A".repeat(100000))); // Large response
				break;

			case "oversized":
				events.push(...this.textEvents(modelName, "B".repeat(1_100_000))); // Bounded-test oversize fixture
				break;

			// Error scenarios handled upstream
			default:
				events.push(...this.textEvents(modelName, "Default mock response."));
		}

		return events;
	}

	// ───── Event builders ─────

	private sse(event: string, data: unknown): string {
		return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
	}

	private textEvents(
		modelName: string,
		text: string,
		usageMode:
			| "normal"
			| "early"
			| "late"
			| "absent"
			| "inconsistent" = "normal",
	): string[] {
		const startUsage =
			usageMode === "absent" || usageMode === "late"
				? {}
				: {
						input_tokens: usageMode === "inconsistent" ? 999 : 10,
						output_tokens: 1,
					};
		const deltaUsage =
			usageMode === "absent" || usageMode === "early"
				? {}
				: {
						output_tokens:
							usageMode === "inconsistent" ? 2 : Math.ceil(text.length / 4),
					};

		return [
			this.sse("message_start", {
				type: "message_start",
				message: {
					id: `msg_${Date.now()}`,
					type: "message",
					role: "assistant",
					content: [],
					model: modelName,
					stop_reason: null,
					usage: startUsage,
				},
			}),
			this.sse("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: { type: "text", text: "" },
			}),
			this.sse("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "text_delta", text },
			}),
			this.sse("content_block_stop", { type: "content_block_stop", index: 0 }),
			this.sse("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: deltaUsage,
			}),
			this.sse("message_stop", { type: "message_stop" }),
		];
	}

	private thinkingEvents(
		modelName: string,
		thinking: string,
		text: string,
		signature?: string,
	): string[] {
		const events = [
			this.sse("message_start", {
				type: "message_start",
				message: {
					id: `msg_${Date.now()}`,
					type: "message",
					role: "assistant",
					content: [],
					model: modelName,
					stop_reason: null,
					usage: { input_tokens: 10, output_tokens: 1 },
				},
			}),
			this.sse("content_block_start", {
				type: "content_block_start",
				index: 0,
				content_block: { type: "thinking", thinking: "" },
			}),
			this.sse("content_block_delta", {
				type: "content_block_delta",
				index: 0,
				delta: { type: "thinking_delta", thinking },
			}),
		];

		if (signature) {
			events.push(
				this.sse("content_block_delta", {
					type: "content_block_delta",
					index: 0,
					delta: { type: "signature_delta", signature },
				}),
			);
		}

		events.push(
			this.sse("content_block_stop", { type: "content_block_stop", index: 0 }),
			this.sse("content_block_start", {
				type: "content_block_start",
				index: 1,
				content_block: { type: "text", text: "" },
			}),
			this.sse("content_block_delta", {
				type: "content_block_delta",
				index: 1,
				delta: { type: "text_delta", text },
			}),
			this.sse("content_block_stop", { type: "content_block_stop", index: 1 }),
			this.sse("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "end_turn", stop_sequence: null },
				usage: {
					output_tokens: Math.ceil((thinking.length + text.length) / 4),
				},
			}),
			this.sse("message_stop", { type: "message_stop" }),
		);

		return events;
	}

	private toolCallEvents(
		modelName: string,
		tools: Array<{ id: string; name: string; args: Record<string, unknown> }>,
	): string[] {
		const events = [
			this.sse("message_start", {
				type: "message_start",
				message: {
					id: `msg_${Date.now()}`,
					type: "message",
					role: "assistant",
					content: [],
					model: modelName,
					stop_reason: null,
					usage: { input_tokens: 10, output_tokens: 1 },
				},
			}),
		];

		for (const tool of tools) {
			events.push(
				this.sse("content_block_start", {
					type: "content_block_start",
					index: tools.indexOf(tool),
					content_block: {
						type: "tool_use",
						id: tool.id,
						name: tool.name,
						input: {},
					},
				}),
				this.sse("content_block_delta", {
					type: "content_block_delta",
					index: tools.indexOf(tool),
					delta: {
						type: "input_json_delta",
						partial_json: JSON.stringify(tool.args),
					},
				}),
				this.sse("content_block_stop", {
					type: "content_block_stop",
					index: tools.indexOf(tool),
				}),
			);
		}

		events.push(
			this.sse("message_delta", {
				type: "message_delta",
				delta: { stop_reason: "tool_use", stop_sequence: null },
				usage: { output_tokens: 20 },
			}),
			this.sse("message_stop", { type: "message_stop" }),
		);

		return events;
	}
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
