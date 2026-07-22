import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { homedir } from "node:os";
import { createObsidianNote } from "./pi-obsidian";

const execFileAsync = promisify(execFile);

const DOTFILES = resolve(homedir(), "dotfiles");
const TEMPLATES_DIR = join(DOTFILES, "shared", "templates");
const AGENT_SESSION = resolve(DOTFILES, "scripts", "agent-session");

interface WorkflowConfig {
	piSessionInbox?: boolean;
	universalSessionInbox?: boolean;
	autoInjectSessionState?: boolean;
	specTemplates?: boolean;
	obsidianBridge?: boolean;
	diffThemeOverride?: boolean;
}

async function readConfig(cwd: string): Promise<WorkflowConfig> {
	const paths = [join(homedir(), ".config", "agent-workflow", "config.json")];
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--git-common-dir"],
			{ cwd, timeout: 2000 },
		);
		const root = resolve(cwd, stdout.trim(), "..");
		paths.push(
			join(root, ".agent-workflow.json"),
			join(root, ".agent-workflow.local.json"),
		);
	} catch {
		/* ignore */
	}
	const cfg: Record<string, unknown> = {};
	for (const p of paths) {
		try {
			if (existsSync(p))
				Object.assign(cfg, JSON.parse(readFileSync(p, "utf8")));
		} catch {
			/* ignore */
		}
	}
	return cfg as WorkflowConfig;
}

async function gitMainRoot(cwd: string): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["rev-parse", "--git-common-dir"],
		{ cwd, timeout: 2000 },
	);
	return resolve(cwd, stdout.trim(), "..");
}

async function runAgentSession(
	args: string[],
	cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await execFileAsync(AGENT_SESSION, args, {
			cwd,
			timeout: 10000,
		});
		return { stdout, stderr, code: 0 };
	} catch (err: any) {
		return {
			stdout: err.stdout || "",
			stderr: err.stderr || String(err),
			code: err.code || 1,
		};
	}
}

function loadTemplate(kind: string): string | undefined {
	const path = join(TEMPLATES_DIR, `${kind}.md`);
	return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

export default function piSession(pi: ExtensionAPI) {
	let activeSessionFile = "";

	async function injectActiveState(ctx: any): Promise<void> {
		const cfg = await readConfig(ctx.cwd);
		if (!cfg.autoInjectSessionState) return;
		const result = await runAgentSession(["active", ctx.cwd], ctx.cwd);
		const file = result.stdout.trim();
		if (!file || file.startsWith("(")) return;
		activeSessionFile = file;
	}

	pi.on("session_start", async (_event, ctx) => {
		await injectActiveState(ctx);
	});

	pi.registerCommand("save-session", {
		description:
			"Save current session state to .agents/sessions/ (args: [work-type] [slug])",
		handler: async (args, ctx) => {
			const cfg = await readConfig(ctx.cwd);
			if (!cfg.universalSessionInbox) {
				ctx.ui.notify("Universal session inbox disabled by config", "warning");
				return;
			}
			const parts = (args || "").trim().split(/\s+/);
			const workType = parts[0] || "";
			const slug = parts.slice(1).join(" ") || "";
			const sessionName = ctx.sessionManager?.getSessionFile() || "";
			const result = await runAgentSession(
				[
					"save",
					"--harness",
					"pi",
					"--kind",
					"session",
					...(workType ? ["--work-type", workType] : []),
					...(slug ? ["--slug", slug] : ""),
					"--goal",
					sessionName || "pi session",
				],
				ctx.cwd,
			);
			if (result.code === 0) {
				ctx.ui.notify("Session saved: " + result.stdout.trim(), "info");
			} else {
				ctx.ui.notify("Save failed: " + result.stderr, "warning");
			}
		},
	});

	pi.registerCommand("clear-context", {
		description:
			"Save state then start fresh session (ctx → 0%). Args: [work-type] [slug]",
		handler: async (args, ctx) => {
			const cfg = await readConfig(ctx.cwd);
			if (!cfg.piSessionInbox) {
				ctx.ui.notify("Pi session inbox disabled by config", "warning");
				return;
			}
			// Step 1: Save
			const parts = (args || "").trim().split(/\s+/);
			const workType = parts[0] || "";
			const slug = parts.slice(1).join(" ") || "";
			const sessionName = ctx.sessionManager?.getSessionFile() || "";
			const saveResult = await runAgentSession(
				[
					"save",
					"--harness",
					"pi",
					"--kind",
					"session",
					...(workType ? ["--work-type", workType] : []),
					...(slug ? ["--slug", slug] : []),
					"--goal",
					sessionName || "pi session",
				],
				ctx.cwd,
			);
			if (saveResult.code !== 0) {
				ctx.ui.notify("Save failed: " + saveResult.stderr, "warning");
				return;
			}
			// Step 2: Start fresh session (ctx → 0%)
			const parentSession = ctx.sessionManager?.getSessionFile();
			try {
				await ctx.newSession(parentSession ? { parentSession } : {});
				ctx.ui.notify(
					"Context cleared — fresh session. Saved: " + saveResult.stdout.trim(),
					"info",
				);
			} catch (err: any) {
				ctx.ui.notify("Failed to start new session: " + String(err), "warning");
			}
		},
	});

	pi.registerCommand("sessions", {
		description:
			"List sessions from .agents/sessions/index.json. Filters: [active|pi|fix|<task>]",
		handler: async (args, ctx) => {
			const filter = (args || "").trim();
			const sessionArgs = ["list"];
			if (filter === "active") sessionArgs.push("--status", "active");
			else if (filter === "pi") sessionArgs.push("--harness", "pi");
			else if (
				[
					"feature",
					"fix",
					"refactor",
					"chore",
					"research",
					"spec",
					"design",
					"arch",
					"pr",
				].includes(filter)
			) {
				sessionArgs.push("--work-type", filter);
			}
			sessionArgs.push(ctx.cwd);
			const result = await runAgentSession(sessionArgs, ctx.cwd);
			if (result.code === 0) {
				const lines = result.stdout.trim().split("\n");
				if (ctx.hasUI && ctx.mode === "tui") {
					const { truncateToWidth } = await import("@earendil-works/pi-tui");
					const rendered = lines.map((l: string) =>
						truncateToWidth(l, process.stdout.columns || 80),
					);
					ctx.ui.setWidget("pi-sessions", rendered);
				} else {
					ctx.ui.notify(result.stdout.trim(), "info");
				}
			}
		},
	});

	pi.registerCommand("resume-session", {
		description:
			"Resume a session: /resume-session <file> or /resume-session to see active sessions",
		handler: async (args, ctx) => {
			const file = (args || "").trim();
			if (!file) {
				const result = await runAgentSession(
					["list", "--status", "active", ctx.cwd],
					ctx.cwd,
				);
				ctx.ui.notify(result.stdout.trim() || "No active sessions", "info");
				return;
			}
			const dirResult = await runAgentSession(["path", ctx.cwd], ctx.cwd);
			if (dirResult.code !== 0) {
				ctx.ui.notify(
					"Could not resolve sessions dir: " + dirResult.stderr,
					"warning",
				);
				return;
			}
			const sessionPath = join(dirResult.stdout.trim(), file);
			if (!existsSync(sessionPath)) {
				ctx.ui.notify("Session file not found: " + file, "warning");
				return;
			}
			const body = readFileSync(sessionPath, "utf8");
			const fmEnd = body.indexOf("\n---\n");
			const content = fmEnd >= 0 ? body.slice(fmEnd + 5) : body;
			ctx.ui.setEditorText(content + "\n\n--- Resume from here ---\n");
			ctx.ui.notify("Session loaded into editor: " + file, "info");
		},
	});

	// ── Spec/Plan/Design/Arch/PR template commands ─────────────────────────
	function templateCommand(name: string, kind: string, description: string) {
		pi.registerCommand(name, {
			description,
			handler: async (args, ctx) => {
				const cfg = await readConfig(ctx.cwd);
				if (!cfg.specTemplates) {
					ctx.ui.notify("Spec templates disabled by config", "warning");
					return;
				}
				const slug = (args || "").trim() || kind;
				const root = await gitMainRoot(ctx.cwd);
				let goal = slug;
				const tpl = loadTemplate(kind);
				if (tpl) {
					goal = tpl.includes("{{goal}}")
						? slug
						: `${kind.toUpperCase()}: ${slug}`;
				}
				const workType = kind === "plan" ? "general" : kind;
				const result = await runAgentSession(
					[
						"save",
						"--harness",
						"pi",
						"--kind",
						kind,
						"--work-type",
						workType,
						"--slug",
						slug,
						"--goal",
						goal,
						ctx.cwd,
					],
					ctx.cwd,
				);
				if (result.code === 0) {
					ctx.ui.notify(
						`${kind.toUpperCase()} created: ${result.stdout.trim()}`,
						"info",
					);
					// Optionally create/update the richer Obsidian session note.
					if (cfg.obsidianBridge) {
						try {
							const note = await createObsidianNote(ctx, {
								kind: kind as any,
								title: slug,
								slug,
								goal,
								contextMode: "since-compaction",
								openAfter: true,
							});
							ctx.ui.notify(
								`${kind.toUpperCase()} Obsidian note: ${note.path}`,
								"info",
							);
						} catch (err: any) {
							ctx.ui.notify("Obsidian note failed: " + String(err), "warning");
						}
					}
				} else {
					ctx.ui.notify("Create failed: " + result.stderr, "warning");
				}
			},
		});
	}

	templateCommand(
		"spec",
		"spec",
		"Create a SPEC document from template. Args: [slug]",
	);
	templateCommand(
		"session-plan",
		"plan",
		"Create a technical PLAN document. Args: [slug]",
	);
	templateCommand("design", "design", "Create a DESIGN document. Args: [slug]");
	templateCommand(
		"arch",
		"arch",
		"Create an ARCHITECTURE document. Args: [slug]",
	);
	templateCommand(
		"pr",
		"pr",
		"Create a PR description from template. Args: [slug]",
	);

	pi.registerCommand("review", {
		description:
			"Show a DiffViewer-backed review preview for a PR. Args: [pr-file]",
		handler: async (args, ctx) => {
			const file = (args || "").trim();
			if (!file) {
				ctx.ui.notify("Usage: /review <pr-file>", "warning");
				return;
			}
			const root = await gitMainRoot(ctx.cwd);
			const reviewPath = join(
				root,
				".diffviewer",
				"artifacts",
				file.replace(".md", ""),
			);
			const hasArtifact = existsSync(reviewPath);
			ctx.ui.notify(
				hasArtifact
					? `Review artifact at .diffviewer/artifacts/${file.replace(".md", "")}`
					: "No DiffViewer artifact found. Run DiffViewer server first.",
				hasArtifact ? "info" : "warning",
			);
			try {
				const note = await createObsidianNote(ctx, {
					kind: "review",
					title: file.replace(/\.md$/, ""),
					slug: file.replace(/\.md$/, ""),
					goal: `Review ${file}`,
					contextMode: "since-compaction",
					includeDiffViewerArtifact: true,
					openAfter: true,
				});
				ctx.ui.notify(`Review Obsidian note: ${note.path}`, "info");
			} catch (err: any) {
				ctx.ui.notify("Review note failed: " + String(err), "warning");
			}
		},
	});

	pi.registerCommand("open", {
		description:
			"Open a session file in Obsidian or nvim. Args: <file.md> [--app obsidian|nvim]",
		handler: async (args, ctx) => {
			const parts = (args || "").trim().split(/\s+/);
			const file = parts[0];
			if (!file || !/^[A-Za-z0-9._-]+\.md$/.test(file)) {
				ctx.ui.notify(
					"Usage: /open <file.md> [--app obsidian|nvim] (plain filename, no path)",
					"warning",
				);
				return;
			}
			const app = parts.includes("--app")
				? parts[parts.indexOf("--app") + 1]
				: "obsidian";
			const dirResult = await runAgentSession(["path", ctx.cwd], ctx.cwd);
			if (dirResult.code !== 0) {
				ctx.ui.notify(
					"Could not resolve sessions dir: " + dirResult.stderr,
					"warning",
				);
				return;
			}
			const sessionPath = join(dirResult.stdout.trim(), file);
			if (!existsSync(sessionPath)) {
				ctx.ui.notify("Session file not found: " + file, "warning");
				return;
			}
			if (app === "obsidian") {
				try {
					await execFileAsync("obsidian-cli", ["open", sessionPath]).catch(
						async () => {
							await execFileAsync("obsidian-cli", [
								"create",
								sessionPath,
								"--content",
								readFileSync(sessionPath, "utf8"),
							]);
						},
					);
					ctx.ui.notify("Opening in Obsidian...", "info");
				} catch (err: any) {
					ctx.ui.notify("Obsidian bridge failed: " + String(err), "warning");
				}
			} else if (app === "nvim") {
				ctx.ui.notify(
					"Use :!nvim " + sessionPath + " from Pi terminal",
					"info",
				);
			}
		},
	});

	// ── Diff renderer with red-for-deletions fix ─────────────────────────────
	pi.registerCommand("diff", {
		description:
			"Render a diff with unambiguous red deletions and green additions. Args: <file>",
		handler: async (args, ctx) => {
			const file = (args || "").trim();
			if (!file) {
				ctx.ui.notify("Usage: /diff <file>", "warning");
				return;
			}
			try {
				const { stdout } = await execFileAsync(
					"git",
					["-C", ctx.cwd, "diff", "--", file],
					{ timeout: 5000 },
				);
				const lines = stdout.split("\n");
				const GREEN = "\x1b[38;5;150m";
				const RED = "\x1b[38;5;210m";
				const DIM = "\x1b[38;5;60m";
				const RST = "\x1b[0m";
				const rendered = lines.map((line) => {
					if (
						line.startsWith("+++") ||
						line.startsWith("---") ||
						line.startsWith("@@") ||
						line.startsWith("diff ")
					) {
						return `${DIM}${line}${RST}`;
					}
					if (line.startsWith("+")) return `${GREEN}${line}${RST}`;
					if (line.startsWith("-")) return `${RED}${line}${RST}`;
					return `${DIM}${line}${RST}`;
				});
				if (ctx.hasUI && ctx.mode === "tui") {
					const { truncateToWidth } = await import("@earendil-works/pi-tui");
					const truncated = rendered.map((l: string) =>
						truncateToWidth(l, process.stdout.columns || 80),
					);
					ctx.ui.setWidget("pi-diff", truncated.slice(0, 50));
				} else {
					ctx.ui.notify(rendered.slice(0, 20).join("\n"), "info");
				}
			} catch (err: any) {
				ctx.ui.notify("Diff failed: " + String(err), "warning");
			}
		},
	});
}
