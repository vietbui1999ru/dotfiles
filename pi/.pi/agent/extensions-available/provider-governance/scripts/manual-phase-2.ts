/**
 * Human-readable Phase 2 smoke test.
 *
 * Usage:
 *   npm run manual:phase2
 *   npm run manual:phase2 -- thinking-signature
 *
 * The command starts a fresh loopback mock, runs Pi --list-models, sends one
 * real Pi RPC prompt, and prints the captured request paths and output summary.
 */

import { spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
	MockAnthropicServer,
	type MockScenario,
} from "../test/mock-anthropic-server.ts";

const extension = join(
	import.meta.dirname,
	"../test/test-provider-extension.ts",
);
const scenario = (process.argv[2] ?? "text-simple") as MockScenario;

function runPi(
	args: string[],
	baseUrl: string,
	input?: string,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
	const agentDir = mkdtempSync(join(tmpdir(), "pi-phase-2-manual-"));
	const child = spawn("pi", args, {
		env: {
			...process.env,
			PI_CODING_AGENT_DIR: agentDir,
			PI_OFFLINE: "1",
			PI_SKIP_VERSION_CHECK: "1",
			MOCK_ANTHROPIC_BASE_URL: baseUrl,
		},
		stdio: ["pipe", "pipe", "pipe"],
	});
	let stdout = "";
	let stderr = "";
	child.stdout.on("data", (chunk: Buffer) => {
		stdout += chunk.toString();
	});
	child.stderr.on("data", (chunk: Buffer) => {
		stderr += chunk.toString();
	});
	if (input) child.stdin.write(input);

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			child.kill("SIGTERM");
			reject(new Error(`Pi timed out\nstdout:\n${stdout}\nstderr:\n${stderr}`));
		}, 10000);
		const poll = setInterval(() => {
			if (stdout.includes('"type":"agent_settled"')) {
				clearInterval(poll);
				child.stdin.end();
				child.kill("SIGTERM");
			}
		}, 50);
		child.on("close", (code) => {
			clearTimeout(timeout);
			clearInterval(poll);
			resolve({ code, stdout, stderr });
		});
		child.on("error", (error) => {
			clearTimeout(timeout);
			clearInterval(poll);
			reject(error);
		});
	});
}

async function main(): Promise<void> {
	const server = new MockAnthropicServer();
	await server.start();
	server.setScenario({ scenario, eventDelayMs: 2 });

	try {
		console.log(`Phase 2 manual smoke test`);
		console.log(`  scenario: ${scenario}`);
		console.log(`  mock:     ${server.url()}`);
		console.log(`  egress:   test extension allows loopback fetch only`);
		console.log("");

		const list = await runPi(["-e", extension, "--list-models"], server.url());
		const listOk =
			list.code === 0 &&
			/mock-anthropic\s+mock-claude-sonnet/.test(list.stdout);
		console.log(
			`${listOk ? "PASS" : "FAIL"} Pi model registry lists mock model`,
		);
		if (!listOk) console.log(list.stdout || list.stderr);

		const rpc = await runPi(
			[
				"--mode",
				"rpc",
				"--provider",
				"mock-anthropic",
				"--model",
				"mock-claude-sonnet",
				"--no-session",
				"-e",
				extension,
			],
			server.url(),
			`${JSON.stringify({ type: "prompt", message: "say hello" })}\n`,
		);
		const requestPaths = server.getRequests().map((request) => request.path);
		const rpcOk =
			(rpc.code === 0 || rpc.code === 143) &&
			rpc.stdout.includes('"type":"agent_settled"');
		const pathsOk =
			requestPaths.length > 0 &&
			requestPaths.every((path) => path === "/v1/messages");
		console.log(`${rpcOk ? "PASS" : "FAIL"} Pi RPC prompt settles`);
		console.log(
			`${pathsOk ? "PASS" : "FAIL"} all captured requests stayed on /v1/messages`,
		);
		console.log(`  captured requests: ${requestPaths.length}`);
		console.log(
			`  exit code: ${rpc.code} (143 is expected harness SIGTERM shutdown)`,
		);
		console.log(
			`  assistant/output events: ${rpc.stdout.split("\n").filter((line) => line.includes("message_end")).length}`,
		);

		if (!listOk || !rpcOk || !pathsOk) process.exitCode = 1;
	} finally {
		await server.stop();
	}
}

main().catch((error) => {
	console.error(
		`FAIL manual smoke: ${error instanceof Error ? error.stack : String(error)}`,
	);
	process.exitCode = 1;
});
