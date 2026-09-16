import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { configKey } from "./post-run-verifier-core.ts";

interface MockCtx {
	cwd: string;
	hasUI: false;
	isProjectTrusted: () => boolean;
}

interface MockPi {
	handlers: Record<string, ((...args: unknown[]) => unknown)[]>;
	commands: Record<string, (args: string, ctx: MockCtx) => Promise<unknown>>;
	messages: unknown[];
	userMessages: string[];
	on: (event: string, handler: (...args: unknown[]) => unknown) => void;
	events: { on: (event: string, handler: (...args: unknown[]) => unknown) => () => void };
	registerCommand: (
		name: string,
		spec: { handler: (args: string, ctx: MockCtx) => Promise<unknown> },
	) => void;
	sendMessage: (content: unknown, opts: unknown) => void;
	sendUserMessage: (text: string, opts: unknown) => void;
}

function makeMockPi(): MockPi {
	const pi: MockPi = {
		handlers: {},
		commands: {},
		messages: [],
		userMessages: [],
		on(event, handler) {
			(pi.handlers[event] ??= []).push(handler);
		},
		events: {
			on(event, handler) {
				(pi.handlers[event] ??= []).push(handler);
				return () => {
					/* unsubscribe stub */
				};
			},
		},
		registerCommand(name, spec) {
			pi.commands[name] = spec.handler;
		},
		sendMessage(content, opts) {
			pi.messages.push({ content, opts });
		},
		sendUserMessage(text, _opts) {
			pi.userMessages.push(text);
		},
	};
	return pi;
}

function makeTempRepo(): string {
	const repo = mkdtempSync(join(tmpdir(), "pi-verifier-smoke-repo-"));
	execFileSync("git", ["init"], { cwd: repo });
	execFileSync("git", ["config", "user.email", "pi@example.com"], { cwd: repo });
	execFileSync("git", ["config", "user.name", "PI Smoke"], { cwd: repo });
	writeFileSync(join(repo, "script.sh"), "#!/usr/bin/env bash\necho hello\n");
	execFileSync("git", ["add", "."], { cwd: repo });
	execFileSync("git", ["commit", "-m", "initial"], { cwd: repo });
	return repo;
}

async function loadExtension(): Promise<((pi: MockPi) => void) | undefined> {
	// Force a fresh module evaluation so per-process state starts clean.
	const module = await import(`../post-run-verifier.ts?smoke=${Date.now()}`);
	return module.default as (pi: MockPi) => void;
}

async function emit(
	pi: MockPi,
	event: string,
	...args: unknown[]
): Promise<void> {
	for (const handler of pi.handlers[event] ?? []) {
		const result = handler(...args);
		if (result && typeof (result as Promise<unknown>).then === "function")
			await result;
	}
}

async function driveWriteAndEnd(
	pi: MockPi,
	ctx: MockCtx,
	path: string,
): Promise<void> {
	await emit(pi, "session_start", {}, ctx);
	await emit(pi, "agent_start", {}, ctx);
	await emit(pi, "tool_result", { isError: false, toolName: "write", input: { path } }, ctx);
	await emit(pi, "agent_end", {}, ctx);
	await emit(pi, "agent_settled", {}, ctx);
}

test("end-to-end: write triggers verification and persists an honest report", async () => {
	const repo = makeTempRepo();
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-verifier-smoke-state-"));
	process.env.PI_VERIFIER_STATE_ROOT = stateRoot;

	const extension = await loadExtension();
	assert.equal(typeof extension, "function");

	const pi = makeMockPi();
	const ctx: MockCtx = { cwd: repo, hasUI: false, isProjectTrusted: () => true };
	extension!(pi);

	await driveWriteAndEnd(pi, ctx, "script.sh");

	const realRepo = realpathSync(repo);
	const configPath = join(stateRoot, `${configKey(realRepo)}.json`);
	const reportPath = join(stateRoot, `${configKey(realRepo)}.report.json`);
	assert.ok(existsSync(configPath), `config should be persisted: ${configPath}`);
	assert.ok(existsSync(reportPath), `report should be persisted: ${reportPath}`);

	const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
		status: string;
		changedFiles: string[];
		commands: { id: string; status: string }[];
		skips: string[];
	};
	assert.equal(report.status, "passed");
	assert.deepEqual(report.changedFiles, ["script.sh"]);
	assert.ok(
		report.commands.some((command) => command.id === "bash-syntax" && command.status === "passed"),
		"bash-syntax should run and pass",
	);
});

test("trust gate skips execution when project is not trusted", async () => {
	const repo = makeTempRepo();
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-verifier-smoke-state-"));
	process.env.PI_VERIFIER_STATE_ROOT = stateRoot;

	const extension = await loadExtension();
	const pi = makeMockPi();
	const ctx: MockCtx = { cwd: repo, hasUI: false, isProjectTrusted: () => false };
	extension!(pi);

	await driveWriteAndEnd(pi, ctx, "script.sh");

	const realRepo = realpathSync(repo);
	const configPath = join(stateRoot, `${configKey(realRepo)}.json`);
	const reportPath = join(stateRoot, `${configKey(realRepo)}.report.json`);
	assert.ok(!existsSync(configPath), "untrusted repo should not persist a config");
	assert.ok(existsSync(reportPath), "untrusted report should still be persisted");
	const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
		status: string;
		skips: string[];
	};
	assert.equal(report.status, "skipped");
	assert.ok(
		report.skips.some((skip) => skip.includes("not trusted")),
		"skip reason should mention trust",
	);
});

test("stale verification is discarded when a new user turn starts before it resolves", async () => {
	const repo = makeTempRepo();
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-verifier-smoke-state-"));
	process.env.PI_VERIFIER_STATE_ROOT = stateRoot;

	// Create a fake bash that sleeps long enough for us to start a new turn.
	const fakeBin = mkdtempSync(join(tmpdir(), "pi-verifier-fake-bin-"));
	const fakeBash = join(fakeBin, "bash");
	writeFileSync(
		fakeBash,
		"#!/bin/sh\nsleep 0.2\nexit 0\n",
		{ mode: 0o755 },
	);
	const originalPath = process.env.PATH;
	process.env.PATH = `${fakeBin}${process.platform === "win32" ? ";" : ":"}${originalPath}`;

	try {
		writeFileSync(join(repo, "script.sh"), "#!/usr/bin/env bash\necho hello\n");

		const extension = await loadExtension();
		const pi = makeMockPi();
		const ctx: MockCtx = { cwd: repo, hasUI: false, isProjectTrusted: () => true };
		extension!(pi);

		await emit(pi, "session_start", {}, ctx);
		await emit(pi, "agent_start", {}, ctx);
		await emit(pi, "tool_result", { isError: false, toolName: "write", input: { path: "script.sh" } }, ctx);

		// Kick off agent_end without awaiting so we can race a new turn.
		const endPromise = emit(pi, "agent_end", {}, ctx);
		// Give boundaryRun time to start verification.
		await new Promise((resolve) => setTimeout(resolve, 50));
		// New user turn while verification is still in flight.
		await emit(pi, "input", { source: "interactive" }, ctx);
		await emit(pi, "agent_start", {}, ctx);
		await endPromise;
		await emit(pi, "agent_settled", {}, ctx);

		assert.equal(pi.userMessages.length, 0, "no repair follow-up should be sent for a stale generation");
	} finally {
		process.env.PATH = originalPath;
	}
});

test("repair stall: empty follow-up generation reruns against last changed files and stops after 3 cycles", async () => {
	const repo = makeTempRepo();
	const stateRoot = mkdtempSync(join(tmpdir(), "pi-verifier-smoke-state-"));
	process.env.PI_VERIFIER_STATE_ROOT = stateRoot;

	// Write an invalid shell script so verification fails.
	writeFileSync(join(repo, "script.sh"), "#!/usr/bin/env bash\nif then\n");

	const extension = await loadExtension();
	const pi = makeMockPi();
	const ctx: MockCtx = { cwd: repo, hasUI: false, isProjectTrusted: () => true };
	extension!(pi);

	// Initial generation with the bad edit.
	await emit(pi, "session_start", {}, ctx);
	await emit(pi, "agent_start", {}, ctx);
	await emit(pi, "tool_result", { isError: false, toolName: "write", input: { path: "script.sh" } }, ctx);
	await emit(pi, "agent_end", {}, ctx);
	await emit(pi, "agent_settled", {}, ctx);

	const realRepo = realpathSync(repo);
	let reportPath = join(stateRoot, `${configKey(realRepo)}.report.json`);
	let report = JSON.parse(readFileSync(reportPath, "utf8")) as {
		status: string;
		repairCyclesUsed: number;
	};
	assert.equal(report.status, "failed");
	assert.equal(pi.userMessages.length, 1);

	// Simulate three repair follow-ups that produce no new edits.
	for (let cycle = 1; cycle <= 3; cycle += 1) {
		await emit(pi, "input", { source: "extension" }, ctx);
		await emit(pi, "agent_start", {}, ctx);
		await emit(pi, "agent_end", {}, ctx);
		await emit(pi, "agent_settled", {}, ctx);
		report = JSON.parse(readFileSync(reportPath, "utf8")) as {
			status: string;
			repairCyclesUsed: number;
		};
		assert.equal(report.status, "failed");
		assert.equal(report.repairCyclesUsed, cycle);
	}

	// After the third cycle the terminal summary should be sent, not another follow-up.
	assert.equal(pi.userMessages.length, 3);
	const terminalMessages = pi.messages.filter(
		(message) =>
			typeof message === "object" &&
			message !== null &&
			(message as { content?: { customType?: string; content?: string } }).content?.customType ===
				"post-run-verification" &&
			(message as { content?: { content?: string } }).content?.content?.includes("stopped after"),
	);
	assert.equal(terminalMessages.length, 1, "terminal report should display exactly once");
});

test("executeArgv settles when a grandchild holds the output pipes open", async () => {
	const module = await import(`../post-run-verifier.ts?exec=${Date.now()}`);
	const startedAt = Date.now();
	const result = await module.executeArgv(
		"bash",
		["-c", "sleep 30 & echo ready"],
		realpathSync(tmpdir()),
		10_000,
		16_000,
	);
	assert.equal(result.code, 0);
	assert.equal(result.killed, false);
	assert.match(result.output, /ready/);
	// Old behavior settled only on `close`, which a long-lived grandchild
	// blocks forever (the timeout killed only the direct child). The fix must
	// settle shortly after the direct child exits, well before the timeout.
	const elapsed = Date.now() - startedAt;
	assert.ok(elapsed < 5_000, `settled after ${elapsed}ms; expected grandchild-independent settle`);
});

test("executeArgv kills the whole process group on timeout", async () => {
	const module = await import(`../post-run-verifier.ts?exec2=${Date.now()}`);
	const marker = `pi-verifier-group-test-${Date.now()}`;
	const result = await module.executeArgv(
		"bash",
		["-c", `sleep 300 & echo ${marker} >&2; sleep 300`],
		realpathSync(tmpdir()),
		1_500,
		16_000,
	);
	assert.equal(result.killed, true);
	assert.ok(result.code !== 0);
	// Give the SIGKILL a moment, then confirm no member of the tree survived.
	await new Promise((resolve) => setTimeout(resolve, 300));
	let survivors = "";
	try {
		survivors = execFileSync("pgrep", ["-f", "sleep 300"], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "ignore"],
		}).trim();
	} catch (error) {
		// pgrep exits 1 when nothing matched — exactly the expected outcome.
		const status = (error as { status?: number }).status;
		if (status !== 1) throw error;
	}
	assert.equal(survivors, "", "timeout must kill grandchildren, not only the direct child");
});
