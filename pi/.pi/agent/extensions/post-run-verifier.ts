import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import {
	accessSync,
	constants,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	buildPlan,
	configKey,
	inferConfig,
	isBehavioralChange,
	isPathInside,
	shouldRegenerateConfig,
	validateConfig,
	type ProjectSnapshot,
	type VerificationConfig,
	type VerificationPlan,
} from "./lib/post-run-verifier-core.ts";

const STATE_ROOT = process.env.PI_VERIFIER_STATE_ROOT
	? resolve(process.env.PI_VERIFIER_STATE_ROOT)
	: join(homedir(), ".pi", "agent", "verification", "projects");
const MAX_DISCOVERED_FILES = 20_000;
const MAX_FINGERPRINT_FILE_BYTES = 1_000_000;
const CANDIDATE_COMMANDS = [
	"node",
	"biome",
	"prettier",
	"eslint",
	"tsc",
	"vitest",
	"jest",
	"ruff",
	"black",
	"pyright",
	"mypy",
	"pytest",
	"gofmt",
	"go",
	"cargo",
	"rustfmt",
	"shfmt",
	"shellcheck",
	"bash",
	"bats",
	"git",
];
const SKIP_DIRECTORIES = new Set([
	".git",
	"node_modules",
	".venv",
	"venv",
	"vendor",
	"target",
	"dist",
	"build",
	".next",
	"coverage",
]);
const FINGERPRINT_FILES = new Set([
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"tsconfig.json",
	"jsconfig.json",
	"biome.json",
	"biome.jsonc",
	"eslint.config.js",
	"eslint.config.cjs",
	"eslint.config.mjs",
	"eslint.config.ts",
	".eslintrc",
	".eslintrc.json",
	".prettierrc",
	".prettierrc.json",
	"prettier.config.js",
	"prettier.config.cjs",
	"pyproject.toml",
	"ruff.toml",
	".ruff.toml",
	"mypy.ini",
	".mypy.ini",
	"pyrightconfig.json",
	"setup.cfg",
	"pytest.ini",
	"go.mod",
	"go.work",
	"Cargo.toml",
	"Cargo.lock",
	"rustfmt.toml",
	".rustfmt.toml",
	".shellcheckrc",
	".editorconfig",
	".shfmt",
]);

interface CommandReport {
	id: string;
	stage: string;
	command: string[];
	status: "passed" | "failed" | "skipped";
	exitCode?: number;
	durationMs: number;
	output: string;
	truncated: boolean;
	reason?: string;
}

export interface VerificationReport {
	version: 1;
	root: string;
	generation: number;
	startedAt: string;
	finishedAt: string;
	mode: "automatic" | "manual" | "final";
	status: "passed" | "failed" | "skipped";
	changedFiles: string[];
	focusedTests: string[];
	commands: CommandReport[];
	skips: string[];
	repairCyclesUsed: number;
	configPath: string;
}

interface LoadedProject {
	root: string;
	snapshot: ProjectSnapshot;
	config?: VerificationConfig;
	configPath: string;
	configError?: string;
	regenerated: boolean;
}

let generation = 0;
let attemptedGeneration = -1;
let completedGeneration = -1;
let running: Promise<VerificationReport> | undefined;
let repairCycles = 0;
let lastReport: VerificationReport | undefined;
let terminalReportDisplayed = false;
let activeRoot: string | undefined;
const generationPaths = new Map<number, Set<string>>();

function canonicalProjectRoot(cwd: string): string {
	let cursor = realpathSync(cwd);
	while (true) {
		if (existsSync(join(cursor, ".git"))) return cursor;
		const parent = dirname(cursor);
		if (parent === cursor) return realpathSync(cwd);
		cursor = parent;
	}
}

function relativeProjectPath(
	root: string,
	rawPath: string,
): string | undefined {
	if (!rawPath || rawPath.includes("\0")) return undefined;
	const absolute = resolve(root, rawPath);
	if (!isPathInside(root, absolute) || !existsSync(absolute)) return undefined;
	try {
		const actual = realpathSync(absolute);
		if (!isPathInside(realpathSync(root), actual) || !statSync(actual).isFile())
			return undefined;
		return relative(root, absolute).split(sep).join("/");
	} catch {
		return undefined;
	}
}

function executableOnPath(command: string): string | undefined {
	if (command.includes("/") || command.includes("\\")) return undefined;
	for (const directory of (process.env.PATH ?? "").split(
		process.platform === "win32" ? ";" : ":",
	)) {
		if (!directory) continue;
		const candidate = join(directory, command);
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			/* keep looking */
		}
	}
	return undefined;
}

function discoverSnapshot(root: string): ProjectSnapshot {
	const files: string[] = [];
	const fileContents: Record<string, string> = {};
	const stack = [root];
	let truncated = false;
	while (stack.length && files.length < MAX_DISCOVERED_FILES) {
		const directory = stack.pop()!;
		let entries;
		try {
			entries = readdirSync(directory, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const entry of entries) {
			if (files.length >= MAX_DISCOVERED_FILES) {
				truncated = true;
				break;
			}
			const absolute = join(directory, entry.name);
			const rel = relative(root, absolute).split(sep).join("/");
			if (entry.isSymbolicLink()) continue;
			if (entry.isDirectory()) {
				if (!SKIP_DIRECTORIES.has(entry.name)) stack.push(absolute);
				continue;
			}
			if (!entry.isFile()) continue;
			files.push(rel);
			if (FINGERPRINT_FILES.has(entry.name)) {
				try {
					if (statSync(absolute).size <= MAX_FINGERPRINT_FILE_BYTES)
						fileContents[rel] = readFileSync(absolute, "utf8");
				} catch {
					/* unreadable manifests are fingerprinted as empty */
				}
			}
		}
	}

	const availableCommands: string[] = [];
	for (const command of CANDIDATE_COMMANDS)
		if (executableOnPath(command)) availableCommands.push(command);
	const localBin = join(root, "node_modules", ".bin");
	try {
		for (const name of readdirSync(localBin)) {
			const rel = `node_modules/.bin/${name}`;
			try {
				accessSync(join(root, rel), constants.X_OK);
				availableCommands.push(rel);
				files.push(rel);
			} catch {
				/* not executable */
			}
		}
	} catch {
		/* no local JavaScript tool directory */
	}

	return {
		canonicalRoot: root,
		files: [...new Set(files)],
		fileContents,
		availableCommands,
		scanTruncated: truncated,
	};
}

function pathsForRoot(root: string): {
	configPath: string;
	reportPath: string;
} {
	const key = configKey(root);
	return {
		configPath: join(STATE_ROOT, `${key}.json`),
		reportPath: join(STATE_ROOT, `${key}.report.json`),
	};
}

function persistJson(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function loadProject(
	cwd: string,
	trusted: boolean,
	initialize = true,
): LoadedProject {
	const root = canonicalProjectRoot(cwd);
	const { configPath } = pathsForRoot(root);
	if (!trusted) {
		return {
			root,
			snapshot: {
				canonicalRoot: root,
				files: [],
				fileContents: {},
				availableCommands: [],
			},
			config: undefined,
			configPath,
			configError: "project is not trusted; discovery and config persist disabled",
			regenerated: false,
		};
	}
	const snapshot = discoverSnapshot(root);
	let config: VerificationConfig | undefined;
	let configError: string | undefined;
	let regenerated = false;
	if (existsSync(configPath)) {
		try {
			const raw = JSON.parse(readFileSync(configPath, "utf8"));
			config = validateConfig(raw, root);
			if (!config)
				configError = "invalid persisted verification config (left untouched)";
		} catch (error) {
			configError = `cannot parse persisted verification config (left untouched): ${String(error)}`;
		}
	}
	if (!config && !existsSync(configPath) && initialize) {
		config = inferConfig(snapshot);
		persistJson(configPath, config);
		regenerated = true;
	} else if (config && shouldRegenerateConfig(config, snapshot)) {
		config = inferConfig(snapshot);
		persistJson(configPath, config);
		regenerated = true;
	}
	return { root, snapshot, config, configPath, configError, regenerated };
}

function resolveCommand(root: string, command: string): string | undefined {
	if (isAbsolute(command)) {
		try {
			accessSync(command, constants.X_OK);
			return command;
		} catch {
			return undefined;
		}
	}
	if (command.includes("/") || command.includes("\\")) {
		const candidate = resolve(root, command);
		if (!isPathInside(root, candidate)) return undefined;
		try {
			accessSync(candidate, constants.X_OK);
			return candidate;
		} catch {
			return undefined;
		}
	}
	return executableOnPath(command);
}

function appendBounded(
	current: Buffer,
	chunk: Buffer,
	cap: number,
): { output: Buffer; truncated: boolean } {
	if (current.length >= cap) return { output: current, truncated: true };
	const remaining = cap - current.length;
	return {
		output: Buffer.concat([current, chunk.subarray(0, remaining)]),
		truncated: chunk.length > remaining,
	};
}

export async function executeArgv(
	command: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	outputCap: number,
): Promise<{
	code: number;
	output: string;
	truncated: boolean;
	killed: boolean;
}> {
	return new Promise((resolveResult) => {
		// Detached makes the child a process-group leader so timeouts can kill
		// the whole tree; workers (vitest/jest/go test/cargo) otherwise hold the
		// stdout pipe open forever and `close` never fires.
		const child = spawn(command, args, {
			cwd,
			shell: false,
			detached: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let output = Buffer.alloc(0);
		let truncated = false;
		let killed = false;
		let settled = false;
		let exitCode: number | null = null;
		let drainTimer: NodeJS.Timeout | undefined;
		const killGroup = (signal: NodeJS.Signals) => {
			if (child.pid === undefined) return;
			try {
				process.kill(-child.pid, signal);
			} catch {
				// Group already gone; fall back to the direct child.
				child.kill(signal);
			}
		};
		const finish = (code: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (drainTimer) clearTimeout(drainTimer);
			// Never leave stray grandchildren behind after settling.
			killGroup("SIGKILL");
			resolveResult({ code, output: output.toString("utf8"), truncated, killed });
		};
		const capture = (chunk: Buffer) => {
			const next = appendBounded(output, chunk, outputCap);
			output = next.output;
			truncated ||= next.truncated;
		};
		child.stdout?.on("data", capture);
		child.stderr?.on("data", capture);
		child.on("error", (error) => {
			capture(Buffer.from(String(error)));
			finish(127);
		});
		// Settle on exit plus a short output-drain window, not on close:
		// close waits for all pipe holders, including grandchildren.
		child.on("exit", (code) => {
			exitCode = code;
			drainTimer = setTimeout(() => finish(exitCode ?? 1), 250);
		});
		child.on("close", (code) => finish(code ?? exitCode ?? 1));
		const timer = setTimeout(() => {
			killed = true;
			killGroup("SIGTERM");
			const force = setTimeout(() => {
				if (!settled) killGroup("SIGKILL");
			}, 1_000);
			force.unref();
		}, timeoutMs);
	});
}

async function behavioralFilesFor(
	root: string,
	paths: string[],
): Promise<{ files: Set<string>; degradation?: string }> {
	const behavioral = new Set<string>();
	const git = executableOnPath("git");
	if (!git || !existsSync(join(root, ".git"))) {
		for (const path of paths) {
			try {
				if (isBehavioralChange(path, readFileSync(join(root, path), "utf8"), true))
					behavioral.add(path);
			} catch {
				/* no coverage selection */
			}
		}
		return {
			files: behavioral,
			degradation:
				"git diff unavailable; behavioral test selection used current file contents",
		};
	}
	for (const path of paths) {
		let diff = await executeArgv(
			git,
			["diff", "--no-ext-diff", "--unified=0", "HEAD", "--", path],
			root,
			3_000,
			16_000,
		);
		if (diff.code !== 0)
			diff = await executeArgv(
				git,
				["diff", "--no-ext-diff", "--unified=0", "--", path],
				root,
				3_000,
				16_000,
			);
		const tracked = await executeArgv(
			git,
			["ls-files", "--error-unmatch", "--", path],
			root,
			3_000,
			1_000,
		);
		let source = diff.output;
		const isNew = tracked.code !== 0;
		if (isNew) {
			try {
				source = readFileSync(join(root, path), "utf8").slice(0, 64_000);
			} catch {
				source = "";
			}
		}
		if (isBehavioralChange(path, source, isNew)) behavioral.add(path);
	}
	return { files: behavioral };
}

function summarizeReport(report: VerificationReport): string {
	const passed = report.commands.filter(
		(item) => item.status === "passed",
	).length;
	const failed = report.commands.filter(
		(item) => item.status === "failed",
	).length;
	return `verification ${report.status}: ${passed} passed, ${failed} failed, ${report.skips.length} skipped`;
}

function failedPrompt(report: VerificationReport, remaining: number): string {
	const failures = report.commands
		.filter((item) => item.status === "failed")
		.map((item) => {
			const output = item.output.trim() || "(no output)";
			return `${item.stage}/${item.id}: ${item.command.join(" ")}\n${output}`;
		})
		.join("\n\n");
	return [
		"Post-run verification failed. Fix only these failures, then finish the run so verification can rerun.",
		failures,
		`${remaining} automatic repair cycle(s) remain after this one. Do not broaden to a full build/test suite.`,
	].join("\n\n");
}

function displayReport(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	report: VerificationReport,
	terminal = false,
): void {
	if (ctx.hasUI)
		ctx.ui.notify(
			summarizeReport(report),
			report.status === "failed"
				? "error"
				: report.status === "passed"
					? "info"
					: "warning",
		);
	pi.sendMessage(
		{
			customType: "post-run-verification",
			content: terminal
				? `Post-run verification stopped after ${report.repairCyclesUsed} repair cycles: ${summarizeReport(report)}`
				: summarizeReport(report),
			display: true,
			details: report,
		},
		{ triggerTurn: false },
	);
}

export async function runVerification(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	paths: string[],
	mode: VerificationReport["mode"],
	runGeneration: number,
	options: { cwd?: string; checkOnly?: boolean } = {},
): Promise<VerificationReport> {
	const startedAt = new Date();
	const trusted = ctx.isProjectTrusted();
	const project = loadProject(options.cwd ?? ctx.cwd, trusted);
	const base: Omit<
		VerificationReport,
		"finishedAt" | "status" | "commands" | "skips" | "focusedTests"
	> = {
		version: 1,
		root: project.root,
		generation: runGeneration,
		startedAt: startedAt.toISOString(),
		mode,
		changedFiles: paths,
		repairCyclesUsed: repairCycles,
		configPath: project.configPath,
	};
	const finishSkipped = (reason: string): VerificationReport => {
		const report: VerificationReport = {
			...base,
			finishedAt: new Date().toISOString(),
			status: "skipped",
			commands: [],
			skips: [reason],
			focusedTests: [],
		};
		persistJson(pathsForRoot(project.root).reportPath, report);
		return report;
	};
	if (!ctx.isProjectTrusted())
		return finishSkipped(
			"project is not trusted; no repo-controlled command was executed",
		);
	if (!project.config)
		return finishSkipped(
			project.configError ?? "verification config unavailable",
		);
	if (!paths.length)
		return finishSkipped("no successful write/edit paths were selected");

	const safePaths = paths
		.map(
			(path) =>
				relativeProjectPath(project.root, path) ??
				relativeProjectPath(project.root, join(project.root, path)),
		)
		.filter((path): path is string => Boolean(path));
	if (!safePaths.length)
		return finishSkipped(
			"no selected paths resolve to regular files inside the canonical project root",
		);
	const behavior = await behavioralFilesFor(project.root, safePaths);
	const plan: VerificationPlan = buildPlan(
		project.config,
		safePaths,
		behavior.files,
		project.snapshot.files,
	);
	if (options.checkOnly) {
		const formatCommands = plan.commands.filter((item) => item.stage === "format");
		plan.commands = plan.commands.filter((item) => item.stage !== "format");
		if (formatCommands.length > 0)
			plan.skips.push(
				"format commands skipped for a sandbox review; verification must not mutate the proposed changes",
			);
	}
	if (project.snapshot.scanTruncated)
		plan.skips.push(
			`project discovery reached ${MAX_DISCOVERED_FILES.toLocaleString()} files; nearby coverage beyond the cap was not considered`,
		);
	if (behavior.degradation) plan.skips.push(behavior.degradation);
	if (project.regenerated)
		plan.skips.push(
			"inferred config regenerated after manifest/config fingerprint change",
		);

	const reports: CommandReport[] = [];
	const totalBudget =
		mode === "final"
			? project.config.budgets.finalTotalTimeoutMs
			: project.config.budgets.totalTimeoutMs;
	const deadline = Date.now() + totalBudget;
	for (const item of plan.commands) {
		const executable = resolveCommand(project.root, item.command);
		if (!executable) {
			reports.push({
				id: item.id,
				stage: item.stage,
				command: [item.command, ...item.args],
				status: "skipped",
				durationMs: 0,
				output: "",
				truncated: false,
				reason: "configured executable is unavailable; nothing was installed",
			});
			continue;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			reports.push({
				id: item.id,
				stage: item.stage,
				command: [item.command, ...item.args],
				status: "failed",
				durationMs: 0,
				output: "total verification time budget exhausted",
				truncated: false,
				reason: "total timeout",
			});
			break;
		}
		const timeout = Math.min(
			item.timeoutMs,
			project.config.budgets.commandTimeoutMs,
			remaining,
		);
		const commandStarted = Date.now();
		const result = await executeArgv(
			executable,
			item.args,
			project.root,
			timeout,
			project.config.budgets.maxOutputBytes,
		);
		reports.push({
			id: item.id,
			stage: item.stage,
			command: [item.command, ...item.args],
			status: result.code === 0 && !result.killed ? "passed" : "failed",
			exitCode: result.code,
			durationMs: Date.now() - commandStarted,
			output: result.output,
			truncated: result.truncated,
			reason: result.killed ? `timed out after ${timeout}ms` : undefined,
		});
		if (result.code !== 0 || result.killed) break;
	}
	const failed = reports.some((item) => item.status === "failed");
	const ran = reports.some(
		(item) => item.status === "passed" || item.status === "failed",
	);
	const report: VerificationReport = {
		...base,
		changedFiles: plan.changedFiles,
		focusedTests: plan.focusedTests,
		commands: reports,
		skips: [
			...plan.skips,
			...reports
				.filter((item) => item.status === "skipped")
				.map((item) => `${item.id}: ${item.reason}`),
		],
		finishedAt: new Date().toISOString(),
		status: failed ? "failed" : ran ? "passed" : "skipped",
	};
	persistJson(pathsForRoot(project.root).reportPath, report);
	return report;
}

function selectedManualPaths(root: string, args: string): string[] {
	if (!args.trim()) return [...(generationPaths.get(generation) ?? [])];
	return args
		.trim()
		.split(/\s+/)
		.map((path) => relativeProjectPath(root, path))
		.filter((path): path is string => Boolean(path));
}

export default function postRunVerifier(pi: ExtensionAPI): void {
	const unsubscribe = pi.events.on("pilens:files:touched", (data) => {
		if (!data || typeof data !== "object") return;
		const payload = data as { cwd?: unknown; paths?: unknown };
		if (typeof payload.cwd !== "string" || !Array.isArray(payload.paths)) return;
		let root: string;
		try {
			root = canonicalProjectRoot(payload.cwd);
		} catch {
			return;
		}
		if (!activeRoot || root !== activeRoot) return;
		const paths = generationPaths.get(generation) ?? new Set<string>();
		for (const raw of payload.paths)
			if (typeof raw === "string") {
				const path = relativeProjectPath(root, raw);
				if (path) paths.add(path);
			}
		generationPaths.set(generation, paths);
	});

	pi.on("session_start", (_event, ctx) => {
		try {
			activeRoot = canonicalProjectRoot(ctx.cwd);
		} catch {
			activeRoot = undefined;
		}
	});

	pi.on("agent_start", (_event, ctx) => {
		generation += 1;
		generationPaths.set(generation, new Set());
		try {
			activeRoot = canonicalProjectRoot(ctx.cwd);
		} catch {
			activeRoot = undefined;
		}
	});

	pi.on("input", (event) => {
		if (event.source !== "extension") {
			repairCycles = 0;
			generationPaths.clear();
			lastReport = undefined;
			terminalReportDisplayed = false;
		}
	});

	pi.on("tool_result", (event, ctx) => {
		if (
			event.isError ||
			(event.toolName !== "write" && event.toolName !== "edit")
		)
			return;
		const raw =
			typeof event.input.path === "string" ? event.input.path : undefined;
		if (!raw) return;
		try {
			const root = canonicalProjectRoot(ctx.cwd);
			const path = relativeProjectPath(root, raw);
			if (!path) return;
			const paths = generationPaths.get(generation) ?? new Set<string>();
			paths.add(path);
			generationPaths.set(generation, paths);
		} catch {
			/* invalid/replaced context: no verification attribution */
		}
	});

	const boundaryRun = async (ctx: ExtensionContext) => {
		let paths = [...(generationPaths.get(generation) ?? [])];
		if (
			!paths.length &&
			lastReport?.status === "failed" &&
			repairCycles >= 1 &&
			repairCycles <= 3 &&
			!terminalReportDisplayed
		) {
			paths = lastReport.changedFiles;
		}
		if (!paths.length || attemptedGeneration === generation) return;
		attemptedGeneration = generation;
		const thisGeneration = generation;
		const startedAt = new Date();
		let root: string;
		let configPath: string;
		try {
			root = canonicalProjectRoot(ctx.cwd);
			configPath = pathsForRoot(root).configPath;
		} catch {
			return;
		}
		running = runVerification(pi, ctx, paths, "automatic", thisGeneration);
		if (ctx.hasUI) ctx.ui.setStatus("post-run-verifier", "verifying…");
		try {
			const report = await running;
			if (thisGeneration !== generation) return;
			lastReport = report;
			completedGeneration = thisGeneration;
			if (report.status === "failed") {
				if (repairCycles < 3 && !terminalReportDisplayed) {
					repairCycles += 1;
					pi.sendUserMessage(failedPrompt(report, 3 - repairCycles), {
						deliverAs: "followUp",
						expandPromptTemplates: false,
					});
				} else if (!terminalReportDisplayed) {
					displayReport(
						pi,
						ctx,
						{ ...report, repairCyclesUsed: repairCycles },
						true,
					);
					terminalReportDisplayed = true;
				}
			} else {
				if (report.status === "passed") {
					repairCycles = 0;
					terminalReportDisplayed = false;
				}
				displayReport(pi, ctx, report);
			}
		} catch (error) {
			const failedReport: VerificationReport = {
				version: 1,
				root,
				generation: thisGeneration,
				startedAt: startedAt.toISOString(),
				finishedAt: new Date().toISOString(),
				mode: "automatic",
				status: "failed",
				changedFiles: paths,
				focusedTests: [],
				commands: [],
				skips: [`verification boundary failed: ${String(error)}`],
				repairCyclesUsed: repairCycles,
				configPath,
			};
			persistJson(pathsForRoot(root).reportPath, failedReport);
			lastReport = failedReport;
			completedGeneration = thisGeneration;
			displayReport(pi, ctx, failedReport, true);
		} finally {
			running = undefined;
			if (ctx.hasUI) ctx.ui.setStatus("post-run-verifier", undefined);
		}
	};

	pi.on("agent_end", async (_event, ctx) => boundaryRun(ctx));
	pi.on("agent_settled", async (_event, ctx) => {
		if (running) await running;
		if (completedGeneration !== generation) await boundaryRun(ctx);
	});

	pi.registerCommand("verify", {
		description:
			"Run budgeted verification for this run's changed files (or listed paths)",
		handler: async (args, ctx) => {
			const root = canonicalProjectRoot(ctx.cwd);
			const paths = selectedManualPaths(root, args);
			const report = await runVerification(pi, ctx, paths, "manual", generation);
			lastReport = report;
			displayReport(pi, ctx, report, report.status === "failed");
		},
	});

	pi.registerCommand("verify-final", {
		description: "Run final verification within the configured final time budget",
		handler: async (args, ctx) => {
			const root = canonicalProjectRoot(ctx.cwd);
			const paths = selectedManualPaths(root, args);
			const report = await runVerification(pi, ctx, paths, "final", generation);
			lastReport = report;
			displayReport(pi, ctx, report, report.status === "failed");
		},
	});

	pi.registerCommand("verify-status", {
		description: "Show the latest post-run verification result",
		handler: async (_args, ctx) => {
			let report = lastReport;
			if (!report) {
				try {
					report = JSON.parse(
						readFileSync(
							pathsForRoot(canonicalProjectRoot(ctx.cwd)).reportPath,
							"utf8",
						),
					);
				} catch {
					/* no report */
				}
			}
			ctx.ui.notify(
				report
					? `${summarizeReport(report)} · ${report.changedFiles.length} file(s) · repair ${repairCycles}/3`
					: "No verification report for this project",
				"info",
			);
		},
	});

	pi.registerCommand("verify-config", {
		description: "Show the active persisted per-project verification config",
		handler: async (_args, ctx) => {
			const project = loadProject(ctx.cwd, ctx.isProjectTrusted());
			const stageSummary = project.config
				? project.config.stages
						.map((stage) => `${stage.stage}:${stage.id}`)
						.join(", ") || "no inferred stages"
				: project.configError;
			ctx.ui.notify(
				`${project.configPath}\n${project.config?.provenance ?? "invalid"} · ${stageSummary}`,
				project.config ? "info" : "error",
			);
		},
	});

	pi.registerCommand("verify-init", {
		description:
			"Create or refresh the safe inferred config; never overwrite manual config",
		handler: async (_args, ctx) => {
			const project = loadProject(ctx.cwd, ctx.isProjectTrusted());
			ctx.ui.notify(
				project.config
					? `${project.regenerated ? "Wrote" : "Kept"} ${project.config.provenance} config: ${project.configPath}`
					: (project.configError ?? "Could not initialize verification config"),
				project.config ? "info" : "error",
			);
		},
	});

	pi.on("session_shutdown", () => unsubscribe());
}
