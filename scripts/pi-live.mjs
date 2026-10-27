/**
 * pi-live — drives one Pi RPC session for `pi-view --live`.
 *
 * Takes the arguments pi-view was given, removes the `-p` prompt, adds
 * `--mode rpc`, and sends the prompt as the first RPC command. A FIFO next to
 * the session id (`$TMPDIR/pi-view/<id>.in`) is the way in: a line becomes a
 * steer while Pi works and a prompt while it is idle, `/abort` stops the
 * current turn, and `/done` ends the session. After Pi settles, a grace timer
 * gives the person time to send another prompt before stdin is closed.
 */
import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, constants, mkdirSync, openSync, rmSync } from "node:fs";
import { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";

export const GRACE_SECONDS = 120;
const DIALOG_METHODS = new Set(["select", "confirm", "input", "editor"]);

/** Split `-- <command> <args…>` into the command, its args, and the `-p` prompt. */
export function buildPiInvocation(argv) {
	const [command, ...rest] = argv;
	const args = [];
	let prompt;
	let mode = false;
	for (let index = 0; index < rest.length; index++) {
		const arg = rest[index];
		if (arg === "-p" || arg === "--print") {
			prompt = rest[++index];
			continue;
		}
		if (arg === "--mode") {
			args.push("--mode", "rpc");
			mode = true;
			index++;
			continue;
		}
		args.push(arg);
	}
	if (!mode) args.unshift("--mode", "rpc");
	return { command, args, prompt };
}

const oneLine = (value) => String(value ?? "").replace(/[\r\n]+/g, " ").trim();

/**
 * The whole driver policy, with no I/O. `commands` are written to Pi's stdin
 * (or, for `note`, to the notes file); `close` means the session is over.
 */
export function nextAction(state, event) {
	const next = { phase: state.phase, graceActive: Boolean(state.graceActive) };
	const commands = [];
	switch (event.type) {
		case "input": {
			const line = String(event.line ?? "").trim();
			if (!line) return { state: next, commands };
			next.graceActive = false;
			if (line === "/done") return { state: next, commands, close: true };
			if (line === "/abort") {
				commands.push({ type: "abort" });
				return { state: next, commands };
			}
			commands.push(
				next.phase === "working"
					? { type: "steer", message: line }
					: { type: "prompt", message: line },
			);
			return { state: next, commands };
		}
		case "agent_start":
			next.phase = "working";
			next.graceActive = false;
			return { state: next, commands };
		case "agent_settled":
			next.phase = "idle";
			next.graceActive = true;
			return { state: next, commands };
		case "grace_expired":
			if (!next.graceActive) return { state: next, commands };
			next.graceActive = false;
			return { state: next, commands, close: true };
		case "extension_ui_request": {
			const request = event.request ?? {};
			if (request.method === "notify") {
				commands.push({ type: "note", text: oneLine(request.message) });
			} else if (DIALOG_METHODS.has(request.method)) {
				commands.push({ type: "extension_ui_response", id: request.id, cancelled: true });
				commands.push({
					type: "note",
					text: `cancelled ${request.method}: ${oneLine(request.title || request.message || request.method)}`,
				});
			}
			return { state: next, commands };
		}
		default:
			return { state: next, commands };
	}
}

/** Split buffered stdout into complete JSONL records, keeping the partial tail. */
function splitRecords(buffer) {
	const end = buffer.lastIndexOf("\n");
	if (end < 0) return { records: [], rest: buffer };
	return {
		records: buffer
			.slice(0, end)
			.split("\n")
			.map((line) => line.replace(/\r$/, ""))
			.filter((line) => line.length > 0),
		rest: buffer.slice(end + 1),
	};
}

async function main(argv) {
	const separator = argv.indexOf("--");
	const commandArgs = separator >= 0 ? argv.slice(separator + 1) : argv;
	const invocation = buildPiInvocation(commandArgs);
	if (!invocation.command || invocation.prompt === undefined) {
		process.stderr.write('usage: pi-live.mjs -- <pi> [arguments] -p "<prompt>"\n');
		return 2;
	}
	const sessionIndex = commandArgs.indexOf("--session-id");
	const sessionId = sessionIndex >= 0 ? commandArgs[sessionIndex + 1] : undefined;
	if (!sessionId) {
		process.stderr.write("pi-live: a --session-id is required to name the input FIFO\n");
		return 2;
	}

	const dir = join(process.env.TMPDIR || tmpdir(), "pi-view");
	mkdirSync(dir, { recursive: true, mode: 0o700 });
	const fifoPath = join(dir, `${sessionId}.in`);
	const notesPath = join(dir, `${sessionId}.notes`);
	rmSync(fifoPath, { force: true });
	rmSync(notesPath, { force: true });
	execFileSync("mkfifo", ["-m", "600", fifoPath]);

	const env = { ...process.env };
	delete env.HERDR_PANE_ID;
	const child = spawn(invocation.command, invocation.args, {
		env,
		stdio: ["pipe", "pipe", "inherit"],
	});
	child.stdin.on("error", () => {});

	let state = { phase: "idle", graceActive: false };
	let graceTimer;
	let fifoStream;
	let refused = false;
	let notifySincePrompt = false;
	let cleaned = false;

	const writeNote = (text) => {
		const line = oneLine(text);
		if (!line) return;
		try {
			appendFileSync(notesPath, `${line}\n`);
		} catch {}
	};

	const send = (command) => {
		if (!child.stdin.writable) return;
		child.stdin.write(`${JSON.stringify(command)}\n`);
	};

	const cancelGrace = () => {
		if (graceTimer) clearTimeout(graceTimer);
		graceTimer = undefined;
	};

	const startGrace = () => {
		cancelGrace();
		graceTimer = setTimeout(() => {
			graceTimer = undefined;
			apply(nextAction(state, { type: "grace_expired" }));
		}, GRACE_SECONDS * 1000);
	};

	const cleanup = () => {
		if (cleaned) return;
		cleaned = true;
		cancelGrace();
		fifoStream?.destroy();
		rmSync(fifoPath, { force: true });
		rmSync(notesPath, { force: true });
	};

	const closeSession = () => {
		cancelGrace();
		fifoStream?.destroy();
		if (!child.stdin.writableEnded) child.stdin.end();
	};

	function apply(action) {
		state = action.state;
		for (const command of action.commands) {
			if (command.type === "note") writeNote(command.text);
			else if (command.type === "extension_ui_response") {
				send({ type: "extension_ui_response", id: command.id, cancelled: true });
			} else {
				if (command.type === "prompt") {
					refused = false;
					notifySincePrompt = false;
				}
				send(command);
			}
		}
		if (action.close) closeSession();
	}

	const handleInput = (line) => {
		cancelGrace();
		apply(nextAction(state, { type: "input", line }));
	};

	const handleRecord = (record) => {
		let parsed;
		try {
			parsed = JSON.parse(record);
		} catch {
			return;
		}
		if (parsed.type === "agent_start") {
			cancelGrace();
			apply(nextAction(state, { type: "agent_start" }));
		} else if (parsed.type === "agent_settled") {
			apply(nextAction(state, { type: "agent_settled" }));
			startGrace();
		} else if (parsed.type === "extension_ui_request") {
			if (parsed.method === "notify") notifySincePrompt = true;
			apply(nextAction(state, { type: "extension_ui_request", request: parsed }));
		} else if (parsed.type === "response" && parsed.command === "prompt") {
			// `handled` starts no run; only an `agent_start` means a run began.
			refused = Boolean(parsed.success && parsed.data?.disposition === "handled" && notifySincePrompt);
			notifySincePrompt = false;
		}
	};

	child.stdout.setEncoding("utf8");
	let buffer = "";
	child.stdout.on("data", (chunk) => {
		buffer += chunk;
		const { records, rest } = splitRecords(buffer);
		buffer = rest;
		for (const record of records) handleRecord(record);
	});

	// Read-write keeps the FIFO from ever reporting end-of-file when a writer
	// disconnects. Non-blocking, read through a Socket: fs.createReadStream would
	// park a blocking read in the thread pool that never ends, and the process
	// could not exit after Pi did.
	fifoStream = new Socket({ fd: openSync(fifoPath, constants.O_RDWR | constants.O_NONBLOCK), readable: true, writable: false });
	fifoStream.on("error", (error) => process.stderr.write(`pi-live: input: ${error.message}\n`));
	createInterface({ input: fifoStream, crlfDelay: Infinity }).on("line", handleInput);

	send({ type: "prompt", message: invocation.prompt });

	return new Promise((resolve) => {
		child.on("error", (error) => {
			process.stderr.write(`pi-live: ${error.message}\n`);
			cleanup();
			resolve(1);
		});
		child.on("exit", (code, signal) => {
			cleanup();
			if (refused) resolve(1);
			else resolve(code ?? (signal ? 1 : 0));
		});
	});
}

if (import.meta.main) {
	process.exitCode = await main(process.argv.slice(2));
}
