#!/usr/bin/env node
/**
 * pi-checks — run a finished Pi run's spec checks, save the result, steer failures back.
 *
 *   pi-checks <worktree> <session-id> [--no-steer]
 *
 * Called by `scripts/pi-view` when a run settles or exits. It runs
 * `ac-run check --record` and, for an approved spec, `floor-guard`, then saves one
 * record per dispatch under `~/.local/state/pi-checks/<session-id>.json`. The
 * `/pi` Monitor and `scripts/pi-outcome` read that record through the rules in
 * `session-band-plugin/hooks/outcome.ts`.
 *
 * A failed check on a `--tui` run is typed back into that run's own pane, at most
 * three rounds per dispatch; a round only counts when it actually steered. After
 * that it notifies instead. It never approves, merges or pushes anything.
 *
 * Exit code is 0 for every run outcome, so a caller's own exit code is never
 * changed by the checks. Missing arguments are a usage error (2); an internal
 * error writes nothing, reports on stderr, and still exits 0.
 *
 * Tests override the binaries and paths: AC_RUN_BIN, FLOOR_GUARD_BIN,
 * HERDR_BIN_PATH, PI_CHECKS_STATE, PI_VIEW_RUN_DIR.
 */
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { diffHash } from "../session-band-plugin/hooks/outcome.ts";

export const MAX_ROUNDS = 3;

const scriptDir = dirname(fileURLToPath(import.meta.url));
const stateDir = () => process.env.PI_CHECKS_STATE || join(homedir(), ".local", "state", "pi-checks");
const runDir = () => process.env.PI_VIEW_RUN_DIR || join(tmpdir(), "pi-view");
const acRunBin = () => process.env.AC_RUN_BIN || join(scriptDir, "ac-run");
const floorGuardBin = () => process.env.FLOOR_GUARD_BIN || join(scriptDir, "floor-guard");
const herdrBin = () => process.env.HERDR_BIN_PATH || "herdr";

const git = (cwd, args) => {
	const result = spawnSync("git", args, { cwd });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${(result.stderr ?? "").toString().trim()}`);
	return result.stdout.toString().trim();
};

const diffHashOf = (cwd) => {
	// spawnSync's 1 MB default would make a large uncommitted diff skip the checks.
	const result = spawnSync("git", ["diff", "HEAD"], { cwd, maxBuffer: 256 * 1024 * 1024 });
	if (result.status !== 0) throw new Error(`git diff HEAD failed: ${(result.stderr ?? "").toString().trim()}`);
	return diffHash((result.stdout ?? Buffer.alloc(0)).toString("utf8"));
};

const readJson = (path) => {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return undefined;
	}
};

const writeRecord = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

/** The `branch:` value in a SPEC.md frontmatter block; undefined when there is none. */
export const frontmatterBranch = (text) => {
	const lines = text.split("\n");
	if (lines[0]?.trim() !== "---") return undefined;
	for (const line of lines.slice(1)) {
		if (line.trim() === "---") return undefined;
		const at = line.indexOf(":");
		if (at > 0 && line.slice(0, at).trim() === "branch") {
			const value = line.slice(at + 1).trim();
			return value || undefined;
		}
	}
	return undefined;
};

/** Each AC's `verify:` line, keyed `AC-n`, for the steer message. */
export const verifyLines = (text) => {
	const found = {};
	let ac;
	let fence = false;
	for (const line of text.split("\n")) {
		if (line.trimStart().startsWith("```")) fence = !fence;
		if (fence) continue;
		const heading = /^-\s+AC-(\d+)\s*:/.exec(line);
		if (heading) {
			ac = `AC-${heading[1]}`;
			continue;
		}
		const verify = /^\s*verify:\s*(.+)$/.exec(line);
		if (verify && ac) found[ac] = verify[1].trim();
	}
	return found;
};

const failingRows = (acs) => Object.entries(acs ?? {})
	.filter(([, row]) => row?.result === "fail" || row?.result === "pre-satisfied");

/** One line per failing AC with its output tail, then the floor-guard findings. */
export const steerMessage = (acs, verify, floorGuard) => {
	const lines = [];
	for (const [name, row] of failingRows(acs)) {
		lines.push(`${name} failed: ${verify[name] ?? "verify"}`);
		const tail = String(row?.tail ?? "").trim();
		if (tail) lines.push(...tail.split("\n"));
	}
	if (floorGuard && !floorGuard.passed && floorGuard.output) lines.push(...floorGuard.output.split("\n"));
	lines.push("Fix these, commit, and stop.");
	return lines.join("\n");
};

/** The id of a pane herdr still knows; a closed pane (Pi quit) answers nothing. */
const livePane = (sessionId) => {
	const file = join(runDir(), `${sessionId}.pane`);
	if (!existsSync(file)) return undefined;
	const pane = readFileSync(file, "utf8").trim().split("\n")[0];
	if (!pane) return undefined;
	const got = spawnSync(herdrBin(), ["pane", "get", pane], { encoding: "utf8" });
	return got.status === 0 ? pane : undefined;
};

/**
 * The review gate refuses plain input while the run's review is pending, and absorbs
 * a review batch for the same session into a new run instead (agent-review's
 * `absorbable` and `queuedBatch`). So the failures go in as one: a `delivered` row in
 * the worktree's review queue, then the text with the batch header as its first line.
 * Nothing is accepted on the way; the new run's review covers the old changes too.
 */
const queueBatch = (worktree, sessionId) => {
	const id = randomUUID();
	const at = new Date().toISOString();
	const queue = join(worktree, ".pi", "agent-review", "threads", "queue.jsonl");
	mkdirSync(dirname(queue), { recursive: true });
	const row = { id, agent: `pi:${sessionId}`, entryIds: [], state: "delivered", queuedAt: at, deliveredAt: at };
	appendFileSync(queue, `${JSON.stringify(row)}\n`);
	return id;
};

/** The same two calls the mod's Continue makes for a `--tui` run. */
const steer = (pane, message) => {
	const sent = spawnSync(herdrBin(), ["pane", "send-text", pane, message], { encoding: "utf8" });
	if (sent.status !== 0) return false;
	const entered = spawnSync(herdrBin(), ["pane", "send-keys", pane, "Enter"], { encoding: "utf8" });
	return entered.status === 0;
};

const notifyFailed = () => {
	const task = process.env.PUEUE_TASK_ID;
	if (!task) return;
	spawnSync(herdrBin(), ["notification", "show", `pi#${task} checks failed, needs you`], { encoding: "utf8" });
};

/** A lock outlives a check only when its process is gone or it is ten minutes old. */
const LOCK_STALE_MS = 600_000;

const pidAlive = (pid) => {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		// EPERM means the process exists but belongs to another user.
		return error?.code === "EPERM";
	}
};

const staleLock = (lockPath) => {
	let age;
	try {
		age = Date.now() - statSync(lockPath).mtimeMs;
	} catch {
		return true;
	}
	if (age > LOCK_STALE_MS) return true;
	let pid;
	try {
		pid = Number(readFileSync(join(lockPath, "pid"), "utf8").trim());
	} catch {
		// No pid yet: a lock another check just made is respected.
		return false;
	}
	return Number.isInteger(pid) && pid > 0 ? !pidAlive(pid) : false;
};

/** Take the per-dispatch lock; false means another check holds it. */
const takeLock = (lockPath) => {
	try {
		mkdirSync(lockPath);
	} catch (error) {
		if (error.code !== "EEXIST") throw error;
		if (!staleLock(lockPath)) return false;
		// A killed run's leftover must not block this dispatch for ever.
		rmSync(lockPath, { recursive: true, force: true });
		try {
			mkdirSync(lockPath);
		} catch (race) {
			if (race.code === "EEXIST") return false;
			throw race;
		}
	}
	writeFileSync(join(lockPath, "pid"), `${process.pid}\n`);
	return true;
};

async function main(argv) {
	const [worktreeArg, sessionId, ...rest] = argv;
	if (!worktreeArg || !sessionId) {
		process.stderr.write("usage: pi-checks <worktree> <session-id> [--no-steer]\n");
		return 2;
	}
	const worktree = resolve(worktreeArg);
	const noSteer = rest.includes("--no-steer");
	const state = stateDir();
	const recordPath = join(state, `${sessionId}.json`);
	const lockPath = join(state, `${sessionId}.lock`);

	mkdirSync(state, { recursive: true });
	// A check is already running for this dispatch; the settle that finds it does nothing.
	if (!takeLock(lockPath)) return 0;

	try {
		const commit = git(worktree, ["rev-parse", "HEAD"]);
		const hash = diffHashOf(worktree);
		const previous = readJson(recordPath);
		// A settle with no new commit and no new uncommitted change spends nothing.
		if (previous?.phase === "done" && previous.commit === commit && previous.diffHash === hash) return 0;

		const now = () => new Date().toISOString();
		writeRecord(recordPath, {
			worktree, phase: "checking", commit, diffHash: hash, time: now(),
			round: previous?.round ?? 0, steered: false,
		});

		try {
			const branch = git(worktree, ["branch", "--show-current"]);
			const specFile = join(worktree, "SPEC.md");
			const specText = existsSync(specFile) ? readFileSync(specFile, "utf8") : undefined;
			const forBranch = specText !== undefined && frontmatterBranch(specText) === branch;

			let specStatus = "none";
			let passed;
			let acs = {};
			let floorGuard;
			let spec;
			if (forBranch) {
				spec = "SPEC.md";
				const tmp = mkdtempSync(join(tmpdir(), "pi-checks-"));
				const saved = join(tmp, "check.json");
				try {
					const result = spawnSync(acRunBin(), ["check", "--record", saved, "SPEC.md"], { cwd: worktree, encoding: "utf8" });
					const exit = result.status;
					const check = exit === 3 ? undefined : readJson(saved);
					if (exit === 3) {
						// No approval record: the spec is not approved, so pass/fail does not apply.
						specStatus = "none";
					} else if (!check) {
						// ac-run could not run this spec (for example a lint failure): not an approved spec.
						process.stderr.write(`pi-checks: ac-run check exited ${exit ?? "?"} without a record\n`);
						specStatus = "none";
					} else {
						acs = check.acs ?? {};
						const rows = Object.values(acs);
						specStatus = rows.length > 0 && rows.every((row) => row?.result === "manual") ? "manual-only" : "approved";
					}
					if (specStatus === "approved") {
						const guard = spawnSync(floorGuardBin(), [], { cwd: worktree, encoding: "utf8" });
						floorGuard = { passed: guard.status === 0, output: `${guard.stdout ?? ""}${guard.stderr ?? ""}`.trim() };
						passed = exit === 0 && floorGuard.passed;
					}
				} finally {
					rmSync(tmp, { recursive: true, force: true });
				}
			}

			// A round is spent only on a new commit, and only when the steer reaches a live Pi.
			// A diff-only change records its result but must not spend a round or steer again.
			const previousRound = previous?.round ?? 0;
			const candidate = commit !== previous?.commit ? previousRound + 1 : previousRound;
			const advanced = candidate > previousRound;
			let round = previousRound;
			let steered = false;
			if (passed === false) {
				const pane = noSteer || !advanced ? undefined : livePane(sessionId);
				if (pane && candidate <= MAX_ROUNDS) {
					const verify = specText === undefined ? {} : verifyLines(specText);
					const batch = queueBatch(worktree, sessionId);
					if (steer(pane, `[review-batch ${batch}]\n${steerMessage(acs, verify, floorGuard)}`)) {
						steered = true;
						round = candidate;
					}
				}
				if (advanced && !steered && candidate >= MAX_ROUNDS) notifyFailed();
			}

			writeRecord(recordPath, {
				worktree,
				phase: "done",
				commit,
				diffHash: hash,
				specStatus,
				...(passed !== undefined ? { passed } : {}),
				round,
				steered,
				...(spec ? { spec } : {}),
				branch,
				time: now(),
				acs,
				...(floorGuard ? { floorGuard } : {}),
			});
			return 0;
		} catch (error) {
			// A run that dies mid-check must not leave the row on `checking` for ever.
			if (previous?.phase === "done") writeRecord(recordPath, previous);
			else rmSync(recordPath, { force: true });
			throw error;
		}
	} finally {
		rmSync(lockPath, { recursive: true, force: true });
	}
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch (error) {
		// Nothing is written for a failed run, so the Monitor never shows a made-up result.
		process.stderr.write(`pi-checks: ${error instanceof Error ? error.message : String(error)}\n`);
		process.exitCode = 0;
	}
}
