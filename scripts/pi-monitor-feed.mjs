#!/usr/bin/env node
/**
 * Prints one JSON document describing the Pi runs on pueue, for the Pi monitor mod.
 *
 *   pi-monitor-feed.mjs [--task <id>]
 *
 * `tasks` lists every pueue task whose command carries --session-id, newest first.
 * `detail` is the transcript of one task: the one named by --task, else the newest
 * running task, else the newest task. Pueue's `envs` and a task's full command are
 * never printed. Pueue being unreachable prints `{ "tasks": [], "unavailable": true }`.
 */
import { execFile } from "node:child_process";
import { open, readdir } from "node:fs/promises";
import { homedir } from "node:os";

import { emptyProgress, fold, sessionDir, sessionFileName } from "../session-band-plugin/hooks/pisession.ts";

const PUEUE = process.env.PUEUE_BIN || "pueue";
const DETAIL_ENTRIES = 200;
const TEXT_LIMIT = 2000;
const READ_BYTES = 256 * 1024;
const SESSION_FLAG = "--session-id";

// Pueue's Done.result is "Success", "Killed", or { Failed: <exit code> }. Exit 3 is the
// review gate, never a failure. A task's own exit code is used when the result has none.
export function outcomeOf(status) {
	const name = typeof status === "string" ? status : Object.keys(status ?? {})[0];
	if (name === "Queued") return "queued";
	if (name === "Paused") return "paused";
	if (name === "Running") return "running";
	if (name === "Killed") return "killed";
	if (name !== "Done") return "failed";
	const result = status.Done?.result;
	if (result === "Success") return "success";
	if (result === "Killed") return "killed";
	const exit = typeof result === "object" && result ? result.Failed : undefined;
	return exit === 3 ? "review" : "failed";
}

// Pueue's Running/Done states carry their own timestamps; anything else has none.
function timesOf(status) {
	const inner = status && typeof status === "object" ? Object.values(status)[0] : undefined;
	const start = inner?.start ? Date.parse(inner.start) : undefined;
	const end = inner?.end ? Date.parse(inner.end) : undefined;
	return {
		startMs: Number.isNaN(start) ? undefined : start,
		endMs: Number.isNaN(end) ? undefined : end,
	};
}

// The value after --session-id in a pueue command, or undefined.
export function sessionIdOf(command) {
	const words = String(command ?? "").split(/\s+/);
	const i = words.indexOf(SESSION_FLAG);
	return i === -1 ? undefined : words[i + 1];
}

// The model and thinking level from --model provider/id[:effort].
export function modelOf(command) {
	const words = String(command ?? "").split(/\s+/);
	const i = words.indexOf("--model");
	if (i === -1 || i + 1 >= words.length) return { model: undefined, effort: undefined };
	const raw = words[i + 1];
	const colon = raw.lastIndexOf(":");
	if (colon > raw.lastIndexOf("/")) return { model: raw.slice(0, colon), effort: raw.slice(colon + 1) };
	return { model: raw, effort: undefined };
}

// Pueue status as parsed JSON, or undefined when pueue cannot be run.
function pueueStatus() {
	return new Promise((resolve) => {
		execFile(PUEUE, ["status", "--json"], { maxBuffer: 64 * 1024 * 1024 }, (error, stdout) => {
			if (error) return resolve(undefined);
			try {
				resolve(JSON.parse(stdout));
			} catch {
				resolve(undefined);
			}
		});
	});
}

/** Read a session file end to end and fold it. Missing files give an empty progress. */
export async function readSession(path) {
	let handle;
	try {
		handle = await open(path, "r");
	} catch {
		return { progress: emptyProgress(), toolCount: 0 };
	}
	let progress = emptyProgress();
	let toolCount = 0;
	const bytes = Buffer.alloc(READ_BYTES);
	const decoder = new TextDecoder();
	try {
		let offset = 0;
		for (;;) {
			const { bytesRead } = await handle.read(bytes, 0, bytes.length, offset);
			if (bytesRead === 0) break;
			offset += bytesRead;
			const chunk = decoder.decode(bytes.subarray(0, bytesRead), { stream: true });
			progress = fold(progress, chunk);
			// Count tools across the whole file, not just the capped entries list.
			toolCount += countTools(chunk);
		}
	} finally {
		await handle.close();
	}
	return { progress, toolCount };
}

// Each assistant toolCall block in a JSONL chunk, counted by a textual match on the
// block type, which is cheap and exact for Pi's session format.
export function countTools(chunk) {
	return (chunk.match(/"type":"toolCall"/g) ?? []).length;
}

/** The newest session file for `sessionId` under the task's working directory. */
async function findSessionPath(cwd, sessionId) {
	if (!cwd || !sessionId) return undefined;
	const dir = `${homedir()}/.pi/agent/sessions/${sessionDir(cwd)}`;
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return undefined;
	}
	const match = sessionFileName(sessionId);
	const name = files.filter((file) => match.test(file)).sort().at(-1);
	return name ? `${dir}/${name}` : undefined;
}

// The fields the monitor shows for one pueue task, with its session folded in. The full
// transcript rides along as `entries` for the detail step; main() strips it from the list.
async function describe(task) {
	const command = task.command ?? task.original_command ?? "";
	const sessionId = sessionIdOf(command);
	const { startMs, endMs } = timesOf(task.status);
	const path = await findSessionPath(task.path, sessionId);
	const { progress, toolCount } = path ? await readSession(path) : { progress: emptyProgress(), toolCount: 0 };
	const fromCommand = modelOf(command);
	const state = Object.keys(task.status ?? {})[0] ?? String(task.status);
	return {
		id: task.id,
		label: task.label ?? "",
		state,
		outcome: outcomeOf(task.status),
		startMs,
		endMs,
		path: task.path,
		session: sessionId,
		model: progress.model ?? fromCommand.model,
		effort: progress.effort ?? fromCommand.effort,
		tokens: progress.tokens,
		cost: progress.cost,
		activity: progress.lastActivity,
		files: progress.files.length,
		tools: toolCount,
		entries: progress.entries,
	};
}

// The transcript slice for the detail view: the last entries, text cut to the limit.
export function detailOf(entries) {
	return entries.slice(-DETAIL_ENTRIES).map((e) => ({
		kind: e.kind,
		text: e.text.length > TEXT_LIMIT ? e.text.slice(0, TEXT_LIMIT) : e.text,
	}));
}

// The summary counts over the described tasks.
export function summaryOf(tasks) {
	const count = (outcome) => tasks.filter((t) => t.outcome === outcome).length;
	return {
		running: count("running"),
		queued: count("queued"),
		review: count("review"),
		failed: count("failed"),
		cost: tasks.reduce((sum, t) => sum + (t.cost || 0), 0),
	};
}

// Which task to detail: the one asked for, else the newest running, else the newest.
export function pickDetail(tasks, wanted) {
	if (wanted !== undefined) return tasks.find((t) => t.id === wanted);
	return tasks.find((t) => t.outcome === "running") ?? tasks[0];
}

async function main(argv) {
	const flag = argv.indexOf("--task");
	const wanted = flag === -1 ? undefined : Number(argv[flag + 1]);
	const status = await pueueStatus();
	if (!status) {
		process.stdout.write(`${JSON.stringify({ tasks: [], unavailable: true })}\n`);
		return 0;
	}
	const rows = Object.values(status.tasks ?? {})
		.filter((task) => String(task?.command ?? task?.original_command ?? "").includes(SESSION_FLAG))
		.sort((a, b) => b.id - a.id);
	const described = [];
	for (const task of rows) described.push(await describe(task));
	const picked = pickDetail(described, wanted);
	const detail = picked ? { id: picked.id, entries: detailOf(picked.entries) } : undefined;
	const tasks = described.map(({ entries, ...rest }) => rest);
	process.stdout.write(`${JSON.stringify({ tasks, summary: summaryOf(described), detail })}\n`);
	return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main(process.argv.slice(2)).then((code) => {
		process.exitCode = code;
	});
}

export { main };
