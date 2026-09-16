#!/usr/bin/env node
/**
 * Persistent tmux status pane for the Pi CLI (v0.9).
 *
 * Standalone process: no Pi or TypeScript dependency. Aggregates live session
 * data that already exists on disk — pi-live-status state, review-gate
 * batches, post-run verification reports, Commandr task bus, Neovim bridge,
 * and git — and renders a compact dashboard. Heartbeats .pi/panel.state.json so other
 * extensions (pi-statusline) can detect a live panel and hand over their
 * crowded segments.
 *
 * Interactive: single-key actions send slash commands back to the Pi pane via
 * the main Pi session, so the panel remains display-only.
 */
import { mkdir, open, readdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, watch } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, basename, resolve } from "node:path";
import { homedir } from "node:os";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

const arg = (name) => {
	const index = process.argv.indexOf(name);
	return index >= 0 ? process.argv[index + 1] : undefined;
};

export async function readJson(path) {
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch {
		return undefined;
	}
}

/** Newest pi-live-status payload in .pi/status/, if any. */
export async function latestLiveStatus(cwd) {
	const dir = join(cwd, ".pi", "status");
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return undefined;
	}
	let best;
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const data = await readJson(join(dir, file));
		if (data?.updatedAt && (!best || data.updatedAt > best.updatedAt)) best = data;
	}
	return best;
}

/**
 * Active DiffViewer review state. A review counts as queued until its decision
 * reaches submitted/parked. Live hunk progress uses the saved draft decision,
 * falling back to the review payload.
 */
export async function reviewState(cwd) {
	const dir = join(cwd, ".pi", "diff-review");
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return { queue: 0, active: undefined };
	}
	let queue = 0;
	let active;
	for (const file of files) {
		if (!file.startsWith("review-") || !file.endsWith(".json")) continue;
		const id = file.slice("review-".length, -".json".length);
		const review = await readJson(join(dir, file));
		if (!review?.id) continue;
		const decision = await readJson(join(dir, `decision-${id}.json`));
		if (decision?.status === "submitted" || decision?.status === "parked") continue;
		queue++;
		if (!active || (review.createdAt ?? "") > (active.review.createdAt ?? ""))
			active = { review, decision };
	}
	return { queue, active };
}

export function hunkProgress(hunks) {
	const progress = {
		total: hunks?.length ?? 0,
		viewed: 0,
		accepted: 0,
		rejected: 0,
		changeRequested: 0,
	};
	for (const hunk of hunks ?? []) {
		const state = hunk?.state === "change-requested" ? "changeRequested" : hunk?.state;
		if (progress[state] !== undefined) progress[state]++;
	}
	return progress;
}

/** Latest persisted verifier result for the current project or a child path. */
export async function verificationState(cwd, home = homedir()) {
	const dir = join(home, ".pi", "agent", "verification", "projects");
	let files;
	try {
		files = await readdir(dir);
	} catch {
		return undefined;
	}
	const target = resolve(cwd);
	let latest;
	for (const file of files) {
		if (!file.endsWith(".report.json")) continue;
		const report = await readJson(join(dir, file));
		const root = typeof report?.root === "string" ? resolve(report.root) : undefined;
		if (!root || (target !== root && !target.startsWith(`${root}/`))) continue;
		if (!latest || String(report.finishedAt ?? "") > String(latest.finishedAt ?? "")) latest = report;
	}
	return latest;
}

/** Resolve the Commandr bus: <git-main-root>/.agents, walking up as fallback. */
export async function agentsBus(cwd, exec = execFileAsync) {
	try {
		const { stdout } = await exec("git", ["rev-parse", "--git-common-dir"], { cwd, timeout: 1500 });
		let common = stdout.trim();
		if (common) {
			if (!common.startsWith("/")) common = resolve(cwd, common);
			const bus = join(dirname(common), ".agents");
			if (existsSync(bus)) return bus;
		}
	} catch { /* fall through to walk-up */ }
	let dir = resolve(cwd);
	while (dir && dir !== dirname(dir)) {
		const candidate = join(dir, ".agents");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	return undefined;
}

async function laneCount(dir) {
	try {
		return (await readdir(dir)).filter((name) => name.endsWith(".md")).length;
	} catch {
		return 0;
	}
}

/** Commandr status from the .agents bus. */
export async function agentsState(cwd, exec = execFileAsync) {
	const bus = await agentsBus(cwd, exec);
	if (!bus) return undefined;
	const [inbox, claimed, done, approvalsDir] = await Promise.all([
		laneCount(join(bus, "inbox")),
		laneCount(join(bus, "claimed")),
		laneCount(join(bus, "done")),
		readdir(join(bus, "approvals")).catch(() => []),
	]);
	const approved = approvalsDir.filter((name) => name.endsWith(".approved")).length;
	const pending = approvalsDir.length - approved;
	let lastEvent;
	try {
		const raw = await readFile(join(bus, "events.jsonl"), "utf8");
		const last = raw.split("\n").filter(Boolean).at(-1);
		if (last) {
			const event = JSON.parse(last);
			lastEvent = event.type ?? event.event ?? event.kind;
		}
	} catch { /* events optional */ }
	return { bus, inbox, claimed, done, approvals: { approved, pending }, lastEvent };
}

export async function nvimState(cwd) {
	const ctx = await readJson(join(cwd, ".pi", "nvim-context.json"));
	return ctx?.relative_file ? { file: ctx.relative_file, line: ctx.cursor?.line } : undefined;
}

/** Parse `opencode stats` box-table output into plain fields. */
export function parseOpencodeStats(text) {
	const totalCost = /Total Cost\s+\$([\d.,]+)/.exec(text)?.[1];
	const avgCostPerDay = /Avg Cost\/Day\s+\$([\d.,]+)/.exec(text)?.[1];
	const sessions = /Sessions\s+([\d,]+)/.exec(text)?.[1];
	return totalCost ? { totalCost, avgCostPerDay, sessions } : undefined;
}

/** Pi cost windows from .pi/status/*.json, deduped by session (latest snapshot). */
export async function piCostWindows(cwd, home = homedir()) {
	const dirs = [join(cwd, ".pi", "status"), join(home, ".pi", "status")];
	const bySession = new Map();
	for (const dir of dirs) {
		let files;
		try {
			files = await readdir(dir);
		} catch {
			continue;
		}
		for (const file of files) {
			if (!file.endsWith(".json")) continue;
			const data = await readJson(join(dir, file));
			const id = String(data?.sessionId ?? file);
			const ts = Date.parse(data?.updatedAt ?? data?.startedAt ?? "");
			const cost = Number(data?.cost ?? 0);
			if (!Number.isFinite(ts) || !Number.isFinite(cost)) continue;
			const prev = bySession.get(id);
			if (!prev || ts > prev.ts) bySession.set(id, { ts, cost });
		}
	}
	const now = Date.now();
	let day = 0;
	let week = 0;
	let total = 0;
	let sessions = 0;
	for (const { ts, cost } of bySession.values()) {
		total += cost;
		sessions++;
		if (now - ts < 24 * 3600_000) day += cost;
		if (now - ts < 7 * 24 * 3600_000) week += cost;
	}
	return { day, week, total, sessions };
}

export function parseResetDuration(text) {
	let ms = 0;
	for (const match of String(text).matchAll(/(\d+)\s*(days?|hours?|hrs?|hr|minutes?|mins?|min)/gi)) {
		const amount = Number(match[1]);
		const unit = match[2].toLowerCase();
		if (unit.startsWith("day")) ms += amount * 24 * 3600_000;
		else if (unit.startsWith("h")) ms += amount * 3600_000;
		else ms += amount * 60_000;
	}
	return ms || undefined;
}

export function formatDuration(ms) {
	const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
	const days = Math.floor(totalMinutes / (24 * 60));
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	return [days ? `${days}d` : "", hours ? `${hours}h` : "", minutes ? `${minutes}m` : ""].filter(Boolean).join(" ") || "now";
}

async function tailFile(path, maxBytes = 64 * 1024) {
	const handle = await open(path, "r");
	try {
		const stat = await handle.stat();
		const length = Math.min(maxBytes, stat.size);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, Math.max(0, stat.size - length));
		return buffer.toString("utf8");
	} finally {
		await handle.close();
	}
}

let goLimitCache = { at: 0, root: "", value: undefined };

/**
 * Latest unexpired OpenCode Go rate/quota limit from Pi's session JSONL logs.
 * The hosted Go API exposes no usage endpoint, but provider errors contain the
 * authoritative period and reset duration (for example: "5-hour ... 4hr 20min").
 */
export async function goUsageLimitState(sessionRoot = join(homedir(), ".pi", "agent", "sessions"), now = Date.now(), ttlMs = 10_000) {
	if (goLimitCache.root === sessionRoot && now - goLimitCache.at < ttlMs) return goLimitCache.value;
	const candidates = [];
	try {
		const dirs = await readdir(sessionRoot, { withFileTypes: true });
		for (const dir of dirs) {
			if (!dir.isDirectory()) continue;
			const child = join(sessionRoot, dir.name);
			for (const file of await readdir(child, { withFileTypes: true })) {
				if (!file.isFile() || !file.name.endsWith(".jsonl")) continue;
				try {
					const handle = await open(join(child, file.name), "r");
					const stat = await handle.stat();
					await handle.close();
					candidates.push({ path: join(child, file.name), mtimeMs: stat.mtimeMs });
				} catch { /* race/deleted file */ }
			}
		}
	} catch { /* no sessions yet */ }
	candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
	let result;
	for (const candidate of candidates.slice(0, 24)) {
		let text;
		try { text = await tailFile(candidate.path); } catch { continue; }
		for (const line of text.split("\n").reverse()) {
			try {
				const entry = JSON.parse(line);
				const message = entry?.message;
				if (message?.provider !== "opencode-go" || typeof message?.errorMessage !== "string") continue;
				const match = /(5-hour|weekly|monthly) usage limit reached\.\s*Resets in\s*([^.]*)/i.exec(message.errorMessage);
				if (!match) continue;
				const resetText = match[2].trim();
				const timestamp = Number(message.timestamp ?? entry.timestamp ?? candidate.mtimeMs);
				const duration = parseResetDuration(resetText);
				const resetAt = duration ? timestamp + duration : undefined;
				if (resetAt && resetAt <= now) continue; // historical, already reset
				result = {
					period: match[1].toLowerCase(),
					resetText,
					resetAt,
					remainingMs: resetAt ? resetAt - now : undefined,
				};
				break;
			} catch { /* malformed JSONL line */ }
		}
		if (result) break;
	}
	goLimitCache = { at: now, root: sessionRoot, value: result };
	return result;
}

let ocCache = { at: 0, value: undefined };

/**
 * OpenCode-account usage: `opencode stats` (TTL-cached CLI parse) + Pi-side
 * cost windows. The hosted dashboard total is not exposed by the zen API
 * (verified 404 across /usage, /billing/*, /dashboard/*), so this local
 * aggregation is the closest trackable approximation.
 */
export async function opencodeUsageState(cwd, exec = execFileAsync, ttlMs = 300_000, home = homedir(), sessionRoot = join(homedir(), ".pi", "agent", "sessions")) {
	const limit = await goUsageLimitState(sessionRoot);
	if (ocCache.value && Date.now() - ocCache.at < ttlMs) return { ...ocCache.value, limit };
	const value = { pi: await piCostWindows(cwd, home) };
	try {
		const { stdout } = await exec("opencode", ["stats"], { timeout: 8000 });
		value.cli = parseOpencodeStats(stdout);
		try {
			const daily = await exec("opencode", ["stats", "--days", "1"], { timeout: 8000 });
			value.cliDay = parseOpencodeStats(daily.stdout)?.totalCost;
		} catch { /* daily window optional */ }
	} catch {
		value.cli = undefined;
	}
	ocCache = { at: Date.now(), value };
	return { ...value, limit };
}

/** Test hook: reset the opencode stats TTL cache. */
export function resetOpencodeCache() {
	ocCache = { at: 0, value: undefined };
}

export async function gitState(cwd, exec = execFileAsync) {
	try {
		const branch = (await exec("git", ["branch", "--show-current"], { cwd, timeout: 1500 })).stdout.trim();
		const dirty = (await exec("git", ["status", "--porcelain"], { cwd, timeout: 2500 })).stdout
			.split("\n").filter(Boolean).length;
		return { branch: branch || "detached", dirty };
	} catch {
		return undefined;
	}
}

export async function collectPanelData(cwd, exec = execFileAsync) {
	const [live, review, verification, nvim, git, agents, opencode] = await Promise.all([
		latestLiveStatus(cwd),
		reviewState(cwd),
		verificationState(cwd),
		nvimState(cwd),
		gitState(cwd, exec),
		agentsState(cwd, exec),
		opencodeUsageState(cwd, exec),
	]);
	const hunks = review.active?.decision?.hunks ?? review.active?.review?.hunks;
	return {
		live,
		review: {
			queue: review.queue,
			path: review.active?.review?.path,
			progress: hunkProgress(hunks),
		},
		verification,
		nvim,
		git,
		agents,
		opencode,
	};
}

// The panel may shrink after a terminal resize. Wrap every value so no text is
// silently lost or rendered beyond the pane boundary.
const clip = (value, _max) => String(value);

function cellWidth(char) {
	const code = char.codePointAt(0) ?? 0;
	if (code === 0 || (code >= 0x300 && code <= 0x36f)) return 0;
	return code >= 0x1100 && (
		code <= 0x115f || code === 0x2329 || code === 0x232a ||
		(code >= 0x2e80 && code <= 0xa4cf && code !== 0x303f) ||
		(code >= 0xac00 && code <= 0xd7a3) ||
		(code >= 0xf900 && code <= 0xfaff) ||
		(code >= 0xfe10 && code <= 0xfe19) ||
		(code >= 0xfe30 && code <= 0xfe6f) ||
		(code >= 0xff00 && code <= 0xff60) ||
		(code >= 0xffe0 && code <= 0xffe6) ||
		(code >= 0x1f300 && code <= 0x1faff)
	) ? 2 : 1;
}

function visibleWidth(text) {
	return [...stripAnsi(text)].reduce((width, char) => width + cellWidth(char), 0);
}

/** Wrap ANSI-styled text while preserving formatting on continuation lines. */
export function wrapText(text, width) {
	const w = Math.max(1, Math.floor(width) || 1);
	const lines = [];
	let line = "";
	let used = 0;
	let activeStyle = "";

	const finishLine = () => {
		lines.push(line + (activeStyle ? ANSI.reset : ""));
		line = activeStyle;
		used = 0;
	};

	for (let index = 0; index < text.length;) {
		const sgr = text.slice(index).match(/^\x1b\[([0-9;]*)m/);
		if (sgr) {
			const sequence = sgr[0];
			const codes = sgr[1].split(";");
			if (codes.includes("") || codes.includes("0")) activeStyle = "";
			else activeStyle += sequence;
			line += sequence;
			index += sequence.length;
			continue;
		}

		const char = String.fromCodePoint(text.codePointAt(index) ?? 0);
		index += char.length;
		if (char === "\n") {
			finishLine();
			continue;
		}
		const charWidth = cellWidth(char);
		if (used > 0 && used + charWidth > w) finishLine();
		line += char;
		used += charWidth;
	}
	if (line || lines.length === 0) lines.push(line + (activeStyle ? ANSI.reset : ""));
	return lines;
}

// ── Catppuccin Macchiato styling (mirrors pi-statusline.ts) ───────────────
export const ANSI = {
	reset: "\x1b[0m",
	peach: "38;5;216",
	green: "38;5;150",
	yellow: "38;5;222",
	red: "38;5;210",
	lavender: "38;5;183",
	teal: "38;5;116",
	dim: "38;5;60",
	bold: "1",
};

export const ICONS = {
	session: "\uf1b3",
	review: "\uf016",
	verify: "\uf00c",
	agents: "\uf0c0",
	nvim: "\ue62b",
	git: "\ue725",
	opencode: "\uf201",
};

const paint = (text, ...codes) => `\x1b[${codes.join(";")}m${text}${ANSI.reset}`;
export const stripAnsi = (text) => text.replace(/\x1b\[[0-9;]*m/g, "");
const padVisible = (styled, width) => styled + " ".repeat(Math.max(0, width - visibleWidth(styled)));

export const MAX_MODEL_HISTORY = 5;

const shortModel = (id) => String(id ?? "?").replace(/^.*\//, "");
const modelRuns = (live) =>
	Array.isArray(live?.modelRuns)
		? live.modelRuns.slice(-MAX_MODEL_HISTORY)
		: [];
const modelHistory = (live) => modelRuns(live)
	.map((run) => `${shortModel(run.id)}${run.turns ? ` ${run.turns}t` : ""}`)
	.join(" → ");

export function renderLines(data, width, actionHints = "") {
	const w = Math.max(1, Math.floor(width) || 1);
	const lines = ["PI PANEL", ""];
	const live = data.live;
	if (live) {
		lines.push("SESSION");
		lines.push(clip(`${live.status ?? "idle"}`, w));
		if (live.model) lines.push(clip(`model ${shortModel(live.model)}`, w));
		const runs = modelRuns(live);
		if (runs.length) lines.push(clip(`run ${runs.at(-1)?.turns ?? 0}t · ${runs.length} model${runs.length === 1 ? "" : "s"}`, w));
		if (runs.length > 1) lines.push(clip(`used ${modelHistory(live)}`, w));
		if (live.context?.percentUsed !== undefined) lines.push(clip(`ctx ${Math.round(live.context.percentUsed)}% · ${live.turns ?? 0} turns`, w));
		if (live.cost !== undefined) lines.push(clip(`cost $${Number(live.cost).toFixed(2)}`, w));
		if (live.currentTool) lines.push(clip(`⚙ ${live.currentTool}`, w));
	} else {
		lines.push("SESSION", clip("(no live status)", w));
	}
	lines.push("", "DIFF REVIEW");
	if (data.review.queue > 0) {
		const p = data.review.progress;
		lines.push(clip(`queue ${data.review.queue}`, w));
		if (data.review.path) lines.push(clip(basename(data.review.path), w));
		lines.push(clip(`viewed ${p.viewed}/${p.total}`, w));
		lines.push(clip(`a:${p.accepted} r:${p.rejected} c:${p.changeRequested}`, w));
	} else {
		lines.push(clip("queue 0", w));
	}
	if (data.verification) {
		const report = data.verification;
		const passed = (report.commands ?? []).filter((command) => command.status === "passed").length;
		const failed = (report.commands ?? []).filter((command) => command.status === "failed").length;
		lines.push("", "VERIFY", clip(`${report.status ?? "unknown"} · ${passed} pass ${failed} fail`, w));
		if (report.changedFiles?.length) lines.push(clip(`${report.changedFiles.length} changed file(s)`, w));
	}
	if (data.opencode) {
		const oc = data.opencode;
		lines.push("", "OPENCODE");
		if (oc.limit) {
			lines.push(clip(`GO ${oc.limit.period} limit`, w));
			lines.push(clip(`reset ${oc.limit.remainingMs ? formatDuration(oc.limit.remainingMs) : oc.limit.resetText}`, w));
		}
		if (oc.cli) lines.push(clip(`oc $${oc.cli.totalCost} all${oc.cliDay ? ` · $${oc.cliDay} 24h` : ""}`, w));
		if (oc.pi) lines.push(clip(`pi 24h $${oc.pi.day.toFixed(2)} · 7d $${oc.pi.week.toFixed(2)}`, w));
	}
	if (data.agents) {
		const a = data.agents;
		lines.push("", "AGENTS");
		lines.push(clip(`cmdr ${a.claimed}c/${a.inbox}i/${a.done}d`, w));
		lines.push(clip(`approvals ${a.approvals.pending}p/${a.approvals.approved}a`, w));
		if (a.lastEvent) lines.push(clip(`last ${a.lastEvent}`, w));
	}
	if (data.nvim) {
		lines.push("", "NVIM", clip(data.nvim.line ? `${data.nvim.file}:${data.nvim.line}` : data.nvim.file, w));
	}
	if (data.git) {
		lines.push("", "GIT", clip(`${data.git.branch} · ${data.git.dirty} dirty`, w));
	}
	if (actionHints) lines.push("", clip(actionHints, w));
	return lines.flatMap((line) => wrapText(line, w));
}

async function heartbeat(cwd) {
	const state = {
		active: true,
		pid: process.pid,
		paneId: process.env.TMUX_PANE,
		startedAt: process.env.PI_PANEL_STARTED_AT ?? new Date().toISOString(),
		updatedAt: new Date().toISOString(),
	};
	try {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(join(cwd, ".pi", "panel.state.json"), JSON.stringify(state));
	} catch { /* heartbeat is advisory */ }
}

/** Parse "r=/diff-review-toggle,v=/verify,m=/model" into [key, label, command] rows. */
export function parseActions(spec = "r=/diff-review-toggle,v=/verify,m=/model") {
	return spec.split(",").flatMap((entry) => {
		const [key, command] = entry.split("=");
		if (!key || !command) return [];
		const label = command.replace(/^\//, "").replace(/-/g, " ");
		return [{ key: key.trim(), command: command.trim(), label }];
	});
}

/** Display-only main-Pi shortcut history; panel keys never invoke commands. */
export function parseKeymapHistory(spec = "C-A-r=toggle diff review,C-A-v=run verification,C-A-m=search models,?=toggle this keymap help") {
	return spec.split(",").flatMap((entry) => {
		const [key, label] = entry.split("=");
		return key && label ? [{ key: key.trim(), label: label.trim() }] : [];
	});
}

/** Styled variant: Catppuccin palette, section icons, status-aware colors. */
export function renderStyledLines(data, width, actionHints = "") {
	const w = Math.max(1, Math.floor(width) || 1);
	const lines = [];
	const line = (plain, ...codes) => {
		const content = clip(plain, w);
		lines.push(codes.length ? paint(content, ...codes) : content);
	};
	const parts = (segments) => {
		const styled = segments
			.map(([text, ...codes]) => codes.length ? paint(clip(text, w), ...codes) : clip(text, w))
			.join("");
		lines.push(styled);
	};
	const section = (icon, label, color) => {
		const heading = clip(` ${icon} ${label} `, w);
		lines.push(paint(heading, color, ANSI.bold) + paint("─".repeat(Math.max(0, w - visibleWidth(heading))), ANSI.dim));
	};

	lines.push(paint(clip(" PI PANEL ", w).padEnd(w), ANSI.bold, ANSI.lavender, "48;5;60"));
	lines.push("");

	const live = data.live;
	section(ICONS.session, "SESSION", ANSI.teal);
	if (live) {
		const statusColor = live.status === "error" ? ANSI.red : live.status === "idle" ? ANSI.green : ANSI.yellow;
		parts([[`● ${live.status ?? "idle"}`, statusColor]]);
		if (live.model) parts([["model ", ANSI.dim], [shortModel(live.model), ANSI.lavender, ANSI.bold]]);
		const runs = modelRuns(live);
		if (runs.length) parts([["run ", ANSI.dim], [`${runs.at(-1)?.turns ?? 0}t`, ANSI.teal], [" · ", ANSI.dim], [`${runs.length} model${runs.length === 1 ? "" : "s"}`, ANSI.dim]]);
		if (runs.length > 1) line(`used ${modelHistory(live)}`, ANSI.dim);
		if (live.context?.percentUsed !== undefined) {
			const pct = Math.round(live.context.percentUsed);
			const ctxColor = pct >= 80 ? ANSI.red : pct >= 50 ? ANSI.yellow : ANSI.green;
			parts([["ctx ", ANSI.dim], [`${pct}%`, ctxColor], [` · ${live.turns ?? 0} turns`, ANSI.dim]]);
		}
		if (live.cost !== undefined) line(`cost $${Number(live.cost).toFixed(2)}`, ANSI.peach);
		if (live.currentTool) line(`⚙ ${live.currentTool}`, ANSI.dim);
	} else {
		line("(no live status)", ANSI.dim);
	}
	lines.push("");

	section(ICONS.review, "DIFF REVIEW", ANSI.peach);
	if (data.review.queue > 0) {
		const p = data.review.progress;
		line(`queue ${data.review.queue}`, ANSI.yellow, ANSI.bold);
		if (data.review.path) line(basename(data.review.path));
		parts([[`viewed ${p.viewed}/${p.total}  `], [`a:${p.accepted} `, ANSI.green], [`r:${p.rejected} `, ANSI.red], [`c:${p.changeRequested}`, ANSI.yellow]]);
	} else {
		line("queue 0", ANSI.dim);
	}

	if (data.verification) {
		const report = data.verification;
		const passed = (report.commands ?? []).filter((command) => command.status === "passed").length;
		const failed = (report.commands ?? []).filter((command) => command.status === "failed").length;
		lines.push("");
		section(ICONS.verify, "VERIFY", ANSI.teal);
		line(`${report.status ?? "unknown"} · ${passed} pass ${failed} fail`, report.status === "failed" ? ANSI.red : report.status === "passed" ? ANSI.green : ANSI.yellow);
		if (report.changedFiles?.length) line(`${report.changedFiles.length} changed file(s)`, ANSI.dim);
	}

	if (data.opencode) {
		const oc = data.opencode;
		lines.push("");
		section(ICONS.opencode, "OPENCODE", ANSI.peach);
		if (oc.limit) {
			parts([["GO ", ANSI.red, ANSI.bold], [`${oc.limit.period} limit`, ANSI.red, ANSI.bold]]);
			parts([["reset ", ANSI.dim], [oc.limit.remainingMs ? formatDuration(oc.limit.remainingMs) : oc.limit.resetText, ANSI.yellow]]);
		}
		if (oc.cli) {
			parts([["oc ", ANSI.dim], [`$${oc.cli.totalCost}`, ANSI.peach, ANSI.bold], [" all", ANSI.dim],
				...(oc.cliDay ? [[" · ", ANSI.dim], [`$${oc.cliDay}`, ANSI.teal], [" 24h", ANSI.dim]] : [])]);
		}
		if (oc.pi) {
			parts([["pi ", ANSI.dim], [`$${oc.pi.day.toFixed(2)}`, ANSI.teal], [" 24h · ", ANSI.dim], [`$${oc.pi.week.toFixed(2)}`, ANSI.teal], [" 7d", ANSI.dim]]);
		}
	}

	if (data.agents) {
		const a = data.agents;
		lines.push("");
		section(ICONS.agents, "AGENTS", ANSI.yellow);
		parts([["cmdr ", ANSI.dim], [`${a.claimed}c`, ANSI.yellow], ["/", ANSI.dim], [`${a.inbox}i`, ANSI.teal], ["/", ANSI.dim], [`${a.done}d`, ANSI.green]]);
		parts([["approvals ", ANSI.dim], [`${a.approvals.pending}p`, a.approvals.pending > 0 ? ANSI.red : ANSI.green], ["/", ANSI.dim], [`${a.approvals.approved}a`, ANSI.green]]);
		if (a.lastEvent) line(`last ${a.lastEvent}`, ANSI.dim);
	}

	if (data.nvim) {
		lines.push("");
		section(ICONS.nvim, "NVIM", ANSI.green);
		line(data.nvim.line ? `${data.nvim.file}:${data.nvim.line}` : data.nvim.file);
	}

	if (data.git) {
		lines.push("");
		section(ICONS.git, "GIT", ANSI.lavender);
		const dirtyColor = data.git.dirty === 0 ? ANSI.green : data.git.dirty <= 5 ? ANSI.yellow : ANSI.red;
		parts([[data.git.branch, ANSI.lavender], [" · ", ANSI.dim], [`${data.git.dirty} dirty`, dirtyColor]]);
	}

	if (actionHints) {
		lines.push("");
		lines.push(paint("─".repeat(w), ANSI.dim));
		line(actionHints, ANSI.dim);
	}
	return lines.flatMap((line) => wrapText(line, w));
}

// Human-facing dashboard: style by default even when the agent toolchain
// injects NO_COLOR for machine consumption. PI_PANEL_STYLE=0 opts out.
const styleEnabled = () => Boolean(process.stdout.isTTY) && process.env.PI_PANEL_STYLE !== "0";

function render(data, columns, hints) {
	const body = styleEnabled()
		? renderStyledLines(data, columns, hints).map((line) => padVisible(line, columns))
		: renderLines(data, columns, hints).map((line) => clip(line, columns).padEnd(columns));
	// Home + overwrite in place + clear-to-end: no scrollback growth on refresh.
	process.stdout.write("\x1b[H" + body.join("\n") + "\n\x1b[J");
}

async function main() {
	const cwd = arg("--cwd") ?? process.cwd();
	const keymaps = parseKeymapHistory(process.env.PI_PANEL_KEYMAPS);
	let showKeymaps = false;
	let dirty = true;
	let data;
	const hints = () => showKeymaps
		? ["KEYMAPS", ...keymaps.map((item) => `${item.key} ${item.label}`), "? hide"].join("\n")
		: "? keymaps";
	const refresh = async () => {
		data = await collectPanelData(cwd);
		render(data, process.stdout.columns || 28, hints());
		dirty = false;
	};
	const mark = () => {
		if (dirty) return;
		dirty = true;
		setTimeout(() => { if (dirty) void refresh(); }, 200);
	};
	for (const dir of [join(cwd, ".pi", "status"), join(cwd, ".pi", "diff-review")]) {
		if (existsSync(dir)) {
			try { watch(dir, { persistent: true }, mark); } catch { /* watch is best-effort */ }
		}
	}
	setInterval(mark, 5000).unref(); // git/nvim/agents poll; unref so watchers own the loop
	setInterval(() => void heartbeat(cwd), 5000).unref();
	process.stdout.on("resize", () => { if (data) render(data, process.stdout.columns || 28, hints()); });

	if (process.stdin.isTTY) {
		process.stdin.setRawMode(true);
		process.stdin.resume();
		process.stdin.on("data", (key) => {
			if (key.toString() !== "?") return;
			showKeymaps = !showKeymaps;
			if (data) render(data, process.stdout.columns || 28, hints());
		});
	}

	await heartbeat(cwd);
	await refresh();
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
