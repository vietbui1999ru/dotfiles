/**
 * Streams one Pi session JSONL file to stdout, one transcript line at a time.
 *
 * The herdr viewer pane that scripts/pi-view opens runs this; the session-band
 * Pi pane renders the same entries through session-band-plugin/hooks/pane.tsx.
 * That module is not imported here because it pulls in the plugin runtime, so
 * the entry kinds and prefixes are copied below and kept in step by hand.
 *
 * With --input it also relays lines typed in the pane to the live session FIFO
 * and prints notes from the pi-live driver as `NOTE …`.
 */
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { createInterface } from "node:readline";

import { emptyProgress, fold, sessionDir, sessionFileName } from "../session-band-plugin/hooks/pisession.ts";

const POLL_MS = 1000;
const TEXT_LIMIT = 280;
const READ_BYTES = 64 * 1024;

/**
 * Printable lines for one transcript entry, mirroring `transcriptLines` in
 * session-band-plugin/hooks/pane.tsx.
 * @param {{ kind: string, text: string }} entry
 * @param {boolean} showThinking
 * @returns {string[]}
 */
export function render(entry, showThinking) {
	if (entry.kind === "thinking") {
		if (!showThinking) return [];
		return [entry.text ? `  · ${entry.text}` : "  · thinking…"];
	}
	if (entry.kind === "text") return [entry.text.slice(0, TEXT_LIMIT)];
	if (entry.kind === "tool") return [entry.text];
	if (entry.kind === "error") return [`ERROR ${entry.text}`];
	if (entry.kind === "output") return entry.text.split("\n").map((line) => `  ↳ ${line}`);
	return [];
}

/**
 * Split buffered text into complete lines, keeping the unterminated tail for the
 * next read.
 * @param {string} buffer
 * @returns {{ lines: string[], rest: string }}
 */
export function splitComplete(buffer) {
	const end = buffer.lastIndexOf("\n");
	if (end < 0) return { lines: [], rest: buffer };
	const lines = buffer.slice(0, end).split("\n").filter((line) => line.length > 0);
	return { lines, rest: buffer.slice(end + 1) };
}

/** Fold complete lines and return the entries they added, in order. */
export function foldChunk(lines) {
	if (lines.length === 0) return [];
	return fold(emptyProgress(), `${lines.join("\n")}\n`).entries;
}

/**
 * Relay lines typed in the pane to the live session FIFO. A missing FIFO means
 * the session ended, so say so once and stop reading input.
 * @param {import("node:stream").Readable} input
 * @param {string} fifo
 * @param {(line: string) => void} [log]
 */
export function relayInput(input, fifo, log = (line) => process.stdout.write(`${line}\n`)) {
	const reader = createInterface({ input, crlfDelay: Infinity });
	let pending = Promise.resolve();
	let ended = false;
	reader.on("line", (line) => {
		pending = pending.then(async () => {
			if (ended) return;
			try {
				const handle = await open(fifo, "r+");
				try {
					await handle.write(`${line}\n`);
				} finally {
					await handle.close();
				}
			} catch (error) {
				if (error?.code === "ENOENT" || error?.code === "ENXIO") {
					ended = true;
					reader.close();
					log("session ended");
				}
			}
		});
	});
	return reader;
}

/** Print each line appended to the notes file as `NOTE <text>`. */
async function tailNotes(path) {
	let handle;
	let offset = 0;
	let buffer = "";
	const decoder = new TextDecoder();
	const bytes = Buffer.alloc(READ_BYTES);
	for (;;) {
		if (!handle) {
			try {
				handle = await open(path, "r");
				offset = 0;
				buffer = "";
			} catch {
				await sleep(POLL_MS);
				continue;
			}
		}
		let bytesRead = 0;
		try {
			({ bytesRead } = await handle.read(bytes, 0, bytes.length, offset));
		} catch {
			await handle.close().catch(() => {});
			handle = undefined;
			continue;
		}
		if (bytesRead > 0) {
			offset += bytesRead;
			buffer += decoder.decode(bytes.subarray(0, bytesRead), { stream: true });
			const { lines, rest } = splitComplete(buffer);
			buffer = rest;
			for (const line of lines) process.stdout.write(`NOTE ${line}\n`);
			continue;
		}
		await sleep(POLL_MS);
	}
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** The newest session file for `id` under `dir`, or undefined while Pi has not created it. */
async function findSessionFile(dir, id) {
	const match = sessionFileName(id);
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return undefined;
	}
	const name = files.filter((file) => match.test(file)).sort().at(-1);
	return name ? `${dir}/${name}` : undefined;
}

async function main(argv) {
	const options = { sessionId: undefined, cwd: undefined, thinking: false, input: undefined };
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index];
		if (arg === "--session-id") options.sessionId = argv[++index];
		else if (arg === "--cwd") options.cwd = argv[++index];
		else if (arg === "--thinking") options.thinking = true;
		else if (arg === "--input") options.input = argv[++index];
		else {
			process.stderr.write(`pi-tail: unknown argument '${arg}'\n`);
			return 2;
		}
	}
	if (!options.sessionId || !options.cwd) {
		process.stderr.write("usage: pi-tail --session-id <id> --cwd <dir> [--thinking] [--input <fifo>]\n");
		return 2;
	}

	if (options.input) {
		relayInput(process.stdin, options.input);
		tailNotes(`${dirname(options.input)}/${options.sessionId}.notes`).catch(() => {});
	}

	const dir = `${homedir()}/.pi/agent/sessions/${sessionDir(options.cwd)}`;
	process.stdout.write(`waiting for ${options.sessionId}…\n`);

	let path;
	while (!(path = await findSessionFile(dir, options.sessionId))) await sleep(POLL_MS);

	const handle = await open(path, "r");
	const decoder = new TextDecoder();
	const bytes = Buffer.alloc(READ_BYTES);
	let offset = 0;
	let buffer = "";

	for (;;) {
		const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
		if (bytesRead > 0) {
			offset += bytesRead;
			buffer += decoder.decode(bytes.subarray(0, bytesRead), { stream: true });
			const { lines, rest } = splitComplete(buffer);
			buffer = rest;
			for (const entry of foldChunk(lines)) {
				for (const line of render(entry, options.thinking)) process.stdout.write(`${line}\n`);
			}
			continue;
		}
		await sleep(POLL_MS);
	}
}

if (import.meta.main) {
	for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => process.exit(0));
	process.exitCode = await main(process.argv.slice(2));
}
