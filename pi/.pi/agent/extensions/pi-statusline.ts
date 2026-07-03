import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

// ── Catppuccin Macchiato palette (ANSI 256) ──────────────────────────────
const C = {
	peach: "38;5;216",
	green: "38;5;150",
	yellow: "38;5;222",
	red: "38;5;210",
	lavender: "38;5;183",
	teal: "38;5;116",
	dim: "38;5;60",
};
const RESET = "\x1b[0m";

function color(text: string, code: string): string {
	return `\x1b[${code}m${text}${RESET}`;
}
function dim(text: string): string {
	return color(text, C.dim);
}

// ── Nerd Font icons (with ASCII fallback built into config) ───────────────
interface Icons {
	dir: string;
	branch: string;
	dirty: string;
	ahead: string;
	behind: string;
	local: string;
	stash: string;
	worktree: string;
	ctx: string;
	model: string;
	agent: string;
	style: string;
	sep: string;
}

const NERD_ICONS: Icons = {
	dir: "\uf07c", //
	branch: "\ue725", //
	dirty: "\uf111", //
	ahead: "\uf06f", //
	behind: "\uf070", //
	local: "\uf0c5", //
	stash: "\uf187", //
	worktree: "\ue7a2", //
	ctx: "\uf07c", //  (reuse folder; distinct by color)
	model: "\uf1b3", //
	agent: "\uf016", //
	style: "\uf1fb", //
	sep: " \u2502 ", //  │
};

const ASCII_ICONS: Icons = {
	dir: "dir:",
	branch: "",
	dirty: "*",
	ahead: "^",
	behind: "v",
	local: "local",
	stash: "stsh",
	worktree: "[wt]",
	ctx: "ctx:",
	model: "(",
	agent: "@",
	style: "[",
	sep: " | ",
};

async function readWorkflowConfig(
	cwd: string,
): Promise<{
	piStatusline?: boolean;
	piStatuslineIcons?: string;
	piStatuslineSegments?: string[];
}> {
	const paths = [join(homedir(), ".config", "agent-workflow", "config.json")];
	// Repo-local
	try {
		const gitProc = await execFileAsync(
			"git",
			["rev-parse", "--git-common-dir"],
			{ cwd, timeout: 2000 },
		);
		const common = gitProc.stdout.trim();
		if (common) {
			const { resolve } = await import("node:path");
			const root = resolve(cwd, common, "..");
			paths.push(join(root, ".agent-workflow.json"));
			paths.push(join(root, ".agent-workflow.local.json"));
		}
	} catch {
		/* ignore */
	}

	const cfg: Record<string, unknown> = {};
	for (const p of paths) {
		try {
			if (existsSync(p)) {
				const raw = await readFile(p, "utf8");
				const data = JSON.parse(raw);
				if (data && typeof data === "object") Object.assign(cfg, data);
			}
		} catch {
			/* ignore malformed */
		}
	}
	return cfg as any;
}

async function gitInfo(cwd: string, icons: Icons): Promise<string> {
	try {
		const { stdout: branchOut } = await execFileAsync(
			"git",
			["-C", cwd, "--no-optional-locks", "branch", "--show-current"],
			{ timeout: 2000 },
		);
		const branch = branchOut.trim();
		if (!branch) return "";

		let dirty = "";
		try {
			await execFileAsync(
				"git",
				["-C", cwd, "--no-optional-locks", "diff", "--quiet"],
				{ timeout: 2000 },
			);
		} catch {
			dirty = " " + color(icons.dirty, C.red);
		}
		try {
			await execFileAsync(
				"git",
				["-C", cwd, "--no-optional-locks", "diff", "--cached", "--quiet"],
				{ timeout: 2000 },
			);
		} catch {
			dirty = " " + color(icons.dirty, C.red);
		}

		// Ahead/behind
		let remoteInfo = "";
		try {
			const { stdout: remoteOut } = await execFileAsync(
				"git",
				[
					"-C",
					cwd,
					"--no-optional-locks",
					"rev-parse",
					"--abbrev-ref",
					`${branch}@{upstream}`,
				],
				{ timeout: 2000 },
			);
			const remote = remoteOut.trim();
			if (remote) {
				const { stdout: countsOut } = await execFileAsync(
					"git",
					[
						"-C",
						cwd,
						"--no-optional-locks",
						"rev-list",
						"--left-right",
						"--count",
						`${remote}...HEAD`,
					],
					{ timeout: 2000 },
				);
				const [behind, ahead] = countsOut.trim().split(/\s+/).map(Number);
				if (ahead > 0)
					remoteInfo += " " + dim(icons.ahead) + color(String(ahead), C.green);
				if (behind > 0)
					remoteInfo +=
						" " + dim(icons.behind) + color(String(behind), C.yellow);
			}
		} catch {
			remoteInfo = " " + dim(icons.local);
		}

		// Stash
		let stashInfo = "";
		try {
			const { stdout: stashOut } = await execFileAsync(
				"git",
				["-C", cwd, "--no-optional-locks", "stash", "list"],
				{ timeout: 2000 },
			);
			const stashCount = stashOut.trim().split("\n").filter(Boolean).length;
			if (stashCount > 0)
				stashInfo = " " + dim(icons.stash) + color(String(stashCount), C.peach);
		} catch {
			/* ignore */
		}

		// Worktree
		let wtInfo = "";
		try {
			const { stdout: gitDirOut } = await execFileAsync(
				"git",
				["-C", cwd, "--no-optional-locks", "rev-parse", "--absolute-git-dir"],
				{ timeout: 2000 },
			);
			const { stdout: commonDirOut } = await execFileAsync(
				"git",
				["-C", cwd, "--no-optional-locks", "rev-parse", "--git-common-dir"],
				{ timeout: 2000 },
			);
			const gitDir = gitDirOut.trim();
			const commonDir = commonDirOut.trim();
			if (gitDir && commonDir && gitDir !== commonDir) {
				const wtName =
					gitDir
						.split("/")
						.slice(-2, -1)[0]
						?.replace(/^worktree-/, "") || "?";
				wtInfo = " " + dim(icons.worktree) + dim(wtName);
			}
		} catch {
			/* ignore */
		}

		const branchColor = dirty ? C.yellow : C.green;
		return (
			" " +
			dim(icons.branch) +
			color(branch, branchColor) +
			dirty +
			remoteInfo +
			stashInfo +
			wtInfo
		);
	} catch {
		return "";
	}
}

function dirSegment(cwd: string, icons: Icons): string {
	const home = homedir();
	let short_dir: string;
	if (cwd === home) {
		short_dir = "~";
	} else {
		const rel = cwd.startsWith(home + "/") ? cwd.slice(home.length + 1) : "";
		if (rel) {
			const parts = rel.split("/");
			short_dir = parts.length > 1 ? parts.slice(-2).join("/") : rel;
		} else {
			const parts = cwd.split("/").filter(Boolean);
			short_dir = parts.length > 1 ? parts.slice(-2).join("/") : cwd;
		}
	}
	return dim(icons.dir) + " " + color(short_dir, C.peach);
}

async function ctxSegment(icons: Icons): Promise<string> {
	try {
		const statusDir = join(homedir(), ".pi", "status");
		if (!existsSync(statusDir)) return "";
		const files = await readdir(statusDir);
		if (!files.length) return "";
		// Find most recent .json
		let latest = "";
		let latestMtime = 0;
		for (const f of files) {
			if (!f.endsWith(".json")) continue;
			const fp = join(statusDir, f);
			const stat = await import("node:fs").then((m) => m.statSync(fp));
			if (stat.mtimeMs > latestMtime) {
				latestMtime = stat.mtimeMs;
				latest = fp;
			}
		}
		if (!latest) return "";
		const raw = await readFile(latest, "utf8");
		const data = JSON.parse(raw);
		const pct = data?.context?.percentUsed;
		if (typeof pct !== "number") return "";
		const pctStr = `${Math.round(pct)}%`;
		const ctxColor = pct >= 70 ? C.red : pct >= 40 ? C.yellow : C.green;
		return dim(icons.sep) + dim(icons.ctx) + color(pctStr, ctxColor);
	} catch {
		return "";
	}
}

function modelSegment(modelName: string, icons: Icons): string {
	if (!modelName) return "";
	const short = modelName.replace(/^claude-/, "").replace(/^gpt-/, "");
	return dim(icons.sep) + dim(icons.model) + " " + color(short, C.lavender);
}

async function composeStatusline(cwd: string, model: string): Promise<string> {
	const cfg = await readWorkflowConfig(cwd);
	if (cfg.piStatusline === false) return "";

	const iconMode = cfg.piStatuslineIcons || "nerd";
	const icons = iconMode === "ascii" ? ASCII_ICONS : NERD_ICONS;
	const segments = cfg.piStatuslineSegments || ["dir", "git", "ctx", "model"];

	let line = dirSegment(cwd, icons);
	if (segments.includes("git")) {
		const git = await gitInfo(cwd, icons);
		if (git) line += git;
	}
	if (segments.includes("ctx")) {
		const ctx = await ctxSegment(icons);
		if (ctx) line += ctx;
	}
	if (segments.includes("model") && model) {
		line += modelSegment(model, icons);
	}
	return line;
}

export default function piStatusline(pi: ExtensionAPI) {
	let currentModel = "";
	let currentCwd = "";

	pi.on("session_start", async (_event, ctx) => {
		currentCwd = ctx.cwd;
		const line = await composeStatusline(ctx.cwd, currentModel);
		if (line && ctx.hasUI) ctx.ui.setStatus("pi-statusline", line);
	});

	pi.on("model_changed", async (event, ctx) => {
		currentModel = event.model?.display_name || event.model?.id || "";
		const line = await composeStatusline(currentCwd || ctx.cwd, currentModel);
		if (line && ctx.hasUI) ctx.ui.setStatus("pi-statusline", line);
	});

	pi.on("turn_end", async (_event, ctx) => {
		const line = await composeStatusline(ctx.cwd, currentModel);
		if (line && ctx.hasUI) ctx.ui.setStatus("pi-statusline", line);
	});

	pi.on("agent_end", async (_event, ctx) => {
		const line = await composeStatusline(ctx.cwd, currentModel);
		if (line && ctx.hasUI) ctx.ui.setStatus("pi-statusline", line);
	});

	pi.registerCommand("statusline", {
		description: "Refresh the Pi statusline footer",
		handler: async (_args, ctx) => {
			const line = await composeStatusline(ctx.cwd, currentModel);
			if (line && ctx.hasUI) {
				ctx.ui.setStatus("pi-statusline", line);
				ctx.ui.notify("Statusline refreshed", "info");
			} else {
				ctx.ui.notify("Statusline disabled or empty", "warning");
			}
		},
	});
}
