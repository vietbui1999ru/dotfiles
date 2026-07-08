import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	Key,
	matchesKey,
	wrapTextWithAnsi,
	type Component,
} from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

interface NvimContext {
	ts?: string;
	cwd?: string;
	root?: string;
	file?: string;
	relative_file?: string;
	filetype?: string;
	mode?: string;
	cursor?: { line?: number; col?: number };
	reference?: string;
	symbol?: {
		name?: string;
		kind?: string;
		range?: { start?: number; end?: number };
	};
	lsp?: { clients?: string[] };
	diagnostic_under_cursor?: Array<Record<string, unknown>>;
	selection?: {
		start?: number;
		end?: number;
		text?: string;
		truncated?: boolean;
	};
	context?: {
		start?: number;
		end?: number;
		text?: string;
		truncated?: boolean;
	};
	diagnostics?: {
		total?: number;
		severity_counts?: Record<string, number>;
		items?: Array<Record<string, unknown>>;
	};
}

interface TaskSummary {
	inbox: string[];
	claimed: string[];
	done: string[];
	bus?: string;
}

interface WorkflowConfig {
	commandr?: boolean;
	preCommitGate?: boolean;
	diffviewer?: boolean;
	neovimCockpit?: boolean;
	piCockpit?: boolean;
	opencodeAdapters?: boolean;
	claudeHooks?: boolean;
	autoOpenNeovimBoard?: boolean;
}

const DEFAULT_WORKFLOW_CONFIG: Required<WorkflowConfig> = {
	commandr: true,
	preCommitGate: true,
	diffviewer: true,
	neovimCockpit: true,
	piCockpit: true,
	opencodeAdapters: true,
	claudeHooks: false,
	autoOpenNeovimBoard: false,
};

function enabled(config: WorkflowConfig, key: keyof WorkflowConfig): boolean {
	return config[key] !== false;
}

async function readJsonObject(path: string): Promise<Record<string, unknown>> {
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed)
			? parsed
			: {};
	} catch {
		return {};
	}
}

async function gitMainRoot(cwd: string): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["rev-parse", "--git-common-dir"],
			{ cwd, timeout: 2000 },
		);
		let common = stdout.trim();
		if (!common) return undefined;
		if (!common.startsWith("/")) common = resolve(cwd, common);
		return dirname(common);
	} catch {
		return undefined;
	}
}

async function readWorkflowConfig(cwd: string): Promise<WorkflowConfig> {
	const root = await gitMainRoot(cwd);
	return {
		...DEFAULT_WORKFLOW_CONFIG,
		...(await readJsonObject(
			join(homedir(), ".config", "agent-workflow", "config.json"),
		)),
		...(root ? await readJsonObject(join(root, ".agent-workflow.json")) : {}),
		...(root
			? await readJsonObject(join(root, ".agent-workflow.local.json"))
			: {}),
	};
}

function compactId(id: string): string {
	return id.length > 32 ? id.slice(0, 30) + "…" : id;
}

function taskIdFromPacketName(name: string): string {
	return (
		name.replace(/\.md$/, "").match(/^[^_]+_[^_]+_(.+)$/)?.[1] ??
		name.replace(/\.md$/, "")
	);
}

async function commandrBus(cwd: string): Promise<string | undefined> {
	const script = `main=$(dirname "$(git rev-parse --git-common-dir 2>/dev/null)" 2>/dev/null)
main=$(cd "$main" 2>/dev/null && pwd -P 2>/dev/null) || exit 1
echo "$main/.agents"`;
	try {
		const { stdout } = await execFileAsync("bash", ["-lc", script], {
			cwd,
			timeout: 2000,
		});
		const bus = stdout.trim();
		return existsSync(bus) ? bus : undefined;
	} catch {
		// Fallback: walk up looking for .agents.
		let dir = resolve(cwd);
		while (dir && dir !== dirname(dir)) {
			const candidate = join(dir, ".agents");
			if (existsSync(candidate)) return candidate;
			dir = dirname(dir);
		}
		return undefined;
	}
}

async function readDirMd(dir: string): Promise<string[]> {
	try {
		const items = await readdir(dir);
		return items
			.flatMap((x) => (x.endsWith(".md") ? [taskIdFromPacketName(x)] : []))
			.sort((a, b) => a.localeCompare(b));
	} catch {
		return [];
	}
}

async function readTasks(cwd: string): Promise<TaskSummary> {
	const bus = await commandrBus(cwd);
	if (!bus) return { inbox: [], claimed: [], done: [] };
	return {
		bus,
		inbox: await readDirMd(join(bus, "inbox")),
		claimed: await readDirMd(join(bus, "claimed")),
		done: await readDirMd(join(bus, "done")),
	};
}

async function findProjectNvimContext(
	cwd: string,
): Promise<string | undefined> {
	let dir = resolve(cwd);
	while (dir && dir !== dirname(dir)) {
		const candidate = join(dir, ".pi", "nvim-context.json");
		if (existsSync(candidate)) return candidate;
		dir = dirname(dir);
	}
	return undefined;
}

async function latestContextPath(cwd: string): Promise<string | undefined> {
	const project = await findProjectNvimContext(cwd);
	if (project) return project;
	const globalPath = join(homedir(), ".cache", "pi-nvim", "context.json");
	return existsSync(globalPath) ? globalPath : undefined;
}

async function readNvimContext(
	cwd: string,
): Promise<{ path?: string; data?: NvimContext; error?: string }> {
	const path = await latestContextPath(cwd);
	if (!path)
		return {
			error:
				"No Neovim context file found. In Neovim use <leader>aC or <leader>aa first.",
		};
	try {
		const raw = await readFile(path, "utf8");
		return { path, data: JSON.parse(raw) as NvimContext };
	} catch (error) {
		return { path, error: String(error) };
	}
}

async function nvimRequestQueuePath(cwd: string): Promise<string> {
	const root = (await gitMainRoot(cwd)) ?? cwd;
	return join(root, ".pi", "nvim-requests.jsonl");
}

async function fileSize(path: string): Promise<number> {
	try {
		return (await stat(path)).size;
	} catch {
		return 0;
	}
}

async function readNewNvimRequests(
	path: string,
	offset: number,
): Promise<{ nextOffset: number; prompts: string[] }> {
	try {
		const raw = await readFile(path, "utf8");
		const nextOffset = Buffer.byteLength(raw);
		if (nextOffset <= offset) return { nextOffset, prompts: [] };
		const chunk = raw.slice(offset);
		const prompts = chunk
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const parsed = JSON.parse(line) as {
						prompt?: string;
						source?: string;
					};
					return parsed.prompt ? [parsed.prompt] : [];
				} catch {
					return [];
				}
			});
		return { nextOffset, prompts };
	} catch {
		return { nextOffset: offset, prompts: [] };
	}
}

function shouldAutoAttachNvimContext(prompt: string): boolean {
	return /(?:^|\s)ctx:(nvim|selection|cursor|diagnostics?|diag|current)(?:\s|$|[.,;:!?])/i.test(
		prompt,
	);
}

function renderContextMarkdown(ctx: NvimContext, sourcePath?: string): string {
	const lines: string[] = [];
	lines.push("# Latest Neovim Context");
	if (sourcePath) lines.push(`source: ${sourcePath}`);
	if (ctx.ts) lines.push(`updated: ${ctx.ts}`);
	if (ctx.root) lines.push(`root: ${ctx.root}`);
	if (ctx.relative_file || ctx.file)
		lines.push(`file: ${ctx.relative_file ?? ctx.file}`);
	if (ctx.filetype) lines.push(`filetype: ${ctx.filetype}`);
	if (ctx.cursor?.line)
		lines.push(`cursor: ${ctx.cursor.line}:${ctx.cursor.col ?? 1}`);
	if (ctx.reference) lines.push(`reference: ${ctx.reference}`);
	if (ctx.symbol?.name)
		lines.push(
			`symbol: ${ctx.symbol.kind ?? "symbol"} ${ctx.symbol.name} ${ctx.symbol.range?.start ?? "?"}-${ctx.symbol.range?.end ?? "?"}`,
		);
	if (ctx.lsp?.clients?.length)
		lines.push(`lsp: ${ctx.lsp.clients.join(", ")}`);
	if (ctx.selection?.text) {
		lines.push("");
		lines.push(
			`## Selection ${ctx.selection.start ?? "?"}-${ctx.selection.end ?? "?"}${ctx.selection.truncated ? " (truncated)" : ""}`,
		);
		lines.push("```");
		lines.push(ctx.selection.text);
		lines.push("```");
	} else if (ctx.context?.text) {
		lines.push("");
		lines.push(
			`## Cursor Context ${ctx.context.start ?? "?"}-${ctx.context.end ?? "?"}${ctx.context.truncated ? " (truncated)" : ""}`,
		);
		lines.push("```");
		lines.push(ctx.context.text);
		lines.push("```");
	}
	if (ctx.diagnostics) {
		lines.push("");
		lines.push(`## Diagnostics (${ctx.diagnostics.total ?? 0})`);
		const c = ctx.diagnostics.severity_counts ?? {};
		lines.push(
			`errors=${c.ERROR ?? 0} warnings=${c.WARN ?? 0} info=${c.INFO ?? 0} hints=${c.HINT ?? 0}`,
		);
		for (const item of ctx.diagnostics.items ?? []) {
			const sev = String(item.severity ?? "?");
			const lnum = String(item.lnum ?? "?");
			const col = String(item.col ?? "?");
			const msg = String(item.message ?? "").replace(/\s+/g, " ");
			lines.push(`- ${sev} L${lnum}:${col}: ${msg}`);
		}
	}
	if (ctx.diagnostic_under_cursor?.length) {
		lines.push("");
		lines.push("## Diagnostics Under Cursor");
		for (const item of ctx.diagnostic_under_cursor) {
			const sev = String(item.severity ?? "?");
			const msg = String(item.message ?? "").replace(/\s+/g, " ");
			lines.push(`- ${sev}: ${msg}`);
		}
	}
	return lines.join("\n");
}

class CockpitPanel implements Component {
	private lines: string[];
	private scroll = 0;

	constructor(
		lines: string[],
		private done: () => void,
	) {
		this.lines = lines;
	}

	private viewportHeight(): number {
		const rows = process.stdout.rows || 40;
		return Math.max(8, Math.floor(rows * 0.82) - 3);
	}

	private move(delta: number): void {
		this.scroll = Math.max(0, this.scroll + delta);
	}

	handleInput(data: string): void {
		if (
			matchesKey(data, Key.escape) ||
			matchesKey(data, Key.enter) ||
			data === "q"
		)
			return this.done();
		if (matchesKey(data, Key.down) || data === "j") return this.move(1);
		if (matchesKey(data, Key.up) || data === "k") return this.move(-1);
		if (matchesKey(data, Key.pageDown) || matchesKey(data, Key.space))
			return this.move(this.viewportHeight());
		if (matchesKey(data, Key.pageUp)) return this.move(-this.viewportHeight());
		if (matchesKey(data, Key.home) || data === "g") {
			this.scroll = 0;
			return;
		}
		if (matchesKey(data, Key.end) || data === "G") {
			this.scroll = Number.MAX_SAFE_INTEGER;
		}
	}

	render(width: number): string[] {
		const wrapWidth = Math.max(20, width - 2);
		const wrapped = this.lines.flatMap((line) =>
			line ? wrapTextWithAnsi(line, wrapWidth) : [""],
		);
		const viewport = this.viewportHeight();
		const maxScroll = Math.max(0, wrapped.length - viewport);
		this.scroll = Math.min(this.scroll, maxScroll);
		const start = this.scroll;
		const body = wrapped.slice(start, start + viewport);
		const footer = `↑↓/jk scroll • PgUp/PgDn page • g/G top/bottom • q close • ${Math.min(start + 1, wrapped.length || 1)}-${Math.min(start + viewport, wrapped.length)}/${wrapped.length}`;
		return [...body, "", footer];
	}
	invalidate(): void {}
}

async function buildCockpitLines(cwd: string, theme: any): Promise<string[]> {
	const config = await readWorkflowConfig(cwd);
	const tasks = enabled(config, "commandr")
		? await readTasks(cwd)
		: { inbox: [], claimed: [], done: [] };
	const ctx = enabled(config, "neovimCockpit")
		? await readNvimContext(cwd)
		: { error: "Neovim cockpit disabled by agent-workflow config" };
	const lines: string[] = [];
	lines.push(
		theme.fg("accent", theme.bold("Pi ↔ Neovim Cockpit")) +
			" " +
			theme.fg("dim", cwd),
	);
	lines.push(
		theme.fg(
			"dim",
			"q/enter/esc close • #TASK autocomplete when Commandr is enabled • /nvim-context paste",
		),
	);
	if (!enabled(config, "piCockpit")) {
		lines.push("");
		lines.push(
			theme.fg("warning", "Pi cockpit disabled by agent-workflow config"),
		);
		return lines;
	}
	lines.push("");
	lines.push(theme.fg("accent", "Commandr"));
	if (enabled(config, "commandr")) {
		lines.push(
			`  inbox=${tasks.inbox.length} claimed=${tasks.claimed.length} done=${tasks.done.length}`,
		);
		if (tasks.claimed.length)
			lines.push(
				`  claimed: ${tasks.claimed.slice(0, 5).map(compactId).join(", ")}`,
			);
		if (tasks.bus) lines.push(theme.fg("dim", `  bus: ${tasks.bus}`));
		if (!tasks.bus)
			lines.push(theme.fg("warning", "  no .agents/ bus attached"));
	} else {
		lines.push(theme.fg("warning", "  disabled by agent-workflow config"));
	}
	lines.push("");
	lines.push(theme.fg("accent", "Neovim"));
	if (ctx.data) {
		const n = ctx.data;
		lines.push(`  file: ${n.relative_file ?? n.file ?? "?"}`);
		lines.push(
			`  cursor: ${n.cursor?.line ?? "?"}:${n.cursor?.col ?? "?"}  mode=${n.mode ?? "?"}`,
		);
		lines.push(
			`  selection: ${n.selection?.text ? `${n.selection.start}-${n.selection.end}` : "none"}`,
		);
		lines.push(`  diagnostics: ${n.diagnostics?.total ?? 0}`);
		if (ctx.path) lines.push(theme.fg("dim", `  context: ${ctx.path}`));
	} else {
		lines.push(theme.fg("warning", `  ${ctx.error ?? "no context"}`));
	}
	lines.push("");
	lines.push(theme.fg("accent", "Cursor-like workflow"));
	lines.push("  1. In Neovim: <leader>aC exports rich editor context");
	lines.push(
		"  2. In Neovim: <leader>ap queues a prompt to the active Pi session",
	);
	lines.push(
		"  3. In Pi: mention ctx:nvim / ctx:selection / ctx:diag to auto-attach context",
	);
	lines.push(
		"  4. In Pi: /nvim-context paste still works for explicit prompt editing",
	);
	lines.push("  5. Use #TASK autocomplete to bind prompts to Commandr tasks");
	return lines;
}

export default function neovimCockpit(pi: ExtensionAPI) {
	let lastStatus = "";
	let requestTimer: NodeJS.Timeout | undefined;
	let requestOffset = 0;
	let requestPath = "";

	async function startRequestBridge(ctx: any) {
		if (requestTimer) clearInterval(requestTimer);
		requestPath = await nvimRequestQueuePath(ctx.cwd);
		requestOffset = await fileSize(requestPath);
		requestTimer = setInterval(() => {
			void (async () => {
				const config = await readWorkflowConfig(ctx.cwd);
				if (!enabled(config, "neovimCockpit")) return;
				const result = await readNewNvimRequests(requestPath, requestOffset);
				requestOffset = result.nextOffset;
				for (const prompt of result.prompts) {
					pi.sendUserMessage(
						prompt,
						ctx.isIdle?.() ? undefined : { deliverAs: "followUp" },
					);
				}
			})().catch(() => {});
		}, 1000);
	}

	async function refreshStatus(ctx: any) {
		if (!ctx.hasUI) return;
		const config = await readWorkflowConfig(ctx.cwd);
		if (!enabled(config, "piCockpit")) return;
		const [tasks, nvim] = await Promise.all([
			enabled(config, "commandr")
				? readTasks(ctx.cwd)
				: Promise.resolve({ inbox: [], claimed: [], done: [] }),
			enabled(config, "neovimCockpit")
				? readNvimContext(ctx.cwd)
				: Promise.resolve({ error: "disabled" }),
		]);
		const nvimLabel = nvim.data?.relative_file
			? `nvim:${nvim.data.relative_file}`
			: "nvim:—";
		const taskLabel = `cmdr:${tasks.claimed.length}c/${tasks.inbox.length}i`;
		lastStatus = `${nvimLabel} ${taskLabel}`;
		ctx.ui.setStatus("neovim-cockpit", ctx.ui.theme.fg("accent", lastStatus));
	}

	pi.on("session_start", async (_event, ctx) => {
		await refreshStatus(ctx);
		await startRequestBridge(ctx);
		if (!ctx.hasUI) return;
		const config = await readWorkflowConfig(ctx.cwd);
		if (!enabled(config, "piCockpit") || !enabled(config, "commandr")) return;

		ctx.ui.addAutocompleteProvider((current: any) => ({
			triggerCharacters: ["#"],
			async getSuggestions(
				lines: string[],
				cursorLine: number,
				cursorCol: number,
				options: any,
			) {
				const line = lines[cursorLine] ?? "";
				const before = line.slice(0, cursorCol);
				const match = before.match(/(?:^|[\s(])#([A-Za-z0-9._-]*)$/);
				if (!match)
					return current.getSuggestions(lines, cursorLine, cursorCol, options);
				const prefix = `#${match[1] ?? ""}`;
				const tasks = await readTasks(ctx.cwd);
				const all = [
					...tasks.claimed.map((id) => ({ id, state: "claimed" })),
					...tasks.inbox.map((id) => ({ id, state: "inbox" })),
					...tasks.done.slice(-20).map((id) => ({ id, state: "done" })),
				];
				const q = (match[1] ?? "").toLowerCase();
				const filtered = all
					.filter((x) => x.id.toLowerCase().includes(q))
					.slice(0, 20);
				return {
					prefix,
					items: filtered.map((x) => ({
						value: `#${x.id}`,
						label: `#${compactId(x.id)}`,
						description: x.state,
					})),
				};
			},
			applyCompletion(
				lines: string[],
				line: number,
				col: number,
				item: any,
				prefix: string,
			) {
				return current.applyCompletion(lines, line, col, item, prefix);
			},
			shouldTriggerFileCompletion(lines: string[], line: number, col: number) {
				return current.shouldTriggerFileCompletion?.(lines, line, col) ?? true;
			},
		}));
	});

	pi.on("turn_end", async (_event, ctx) => refreshStatus(ctx));
	pi.on("agent_end", async (_event, ctx) => refreshStatus(ctx));
	pi.on("session_shutdown", async () => {
		if (requestTimer) clearInterval(requestTimer);
		requestTimer = undefined;
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const prompt = String(event.prompt ?? "");
		if (!shouldAutoAttachNvimContext(prompt)) return;
		const config = await readWorkflowConfig(ctx.cwd);
		if (!enabled(config, "neovimCockpit")) return;
		const latest = await readNvimContext(ctx.cwd);
		if (!latest.data) {
			return {
				message: {
					customType: "nvim-context",
					content: latest.error ?? "No Neovim context found.",
					display: true,
				},
			};
		}
		return {
			message: {
				customType: "nvim-context",
				content: `Auto-attached latest Neovim context because the prompt used ctx:nvim/ctx:selection/ctx:cursor/ctx:diag.\n\n${renderContextMarkdown(latest.data, latest.path)}`,
				display: true,
			},
		};
	});

	pi.registerCommand("cockpit", {
		description: "Show Neovim/Commandr/DiffViewer operator cockpit panel",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI || ctx.mode !== "tui") {
				ctx.ui.notify(lastStatus || "Neovim cockpit loaded", "info");
				return;
			}
			const lines = await buildCockpitLines(ctx.cwd, ctx.ui.theme);
			await ctx.ui.custom<void>(
				(_tui: any, _theme: any, _kb: any, done: () => void) =>
					new CockpitPanel(lines, done),
				{
					overlay: true,
					overlayOptions: {
						anchor: "center",
						width: "90%",
						maxHeight: "90%",
						margin: 1,
					},
				},
			);
		},
	});

	pi.registerCommand("nvim-context", {
		description:
			"Show or paste latest Neovim editor context (use: /nvim-context paste)",
		handler: async (args, ctx) => {
			const config = await readWorkflowConfig(ctx.cwd);
			if (!enabled(config, "neovimCockpit")) {
				ctx.ui.notify(
					"Neovim cockpit disabled by agent-workflow config",
					"warning",
				);
				return;
			}
			const latest = await readNvimContext(ctx.cwd);
			if (!latest.data) {
				ctx.ui.notify(latest.error ?? "No Neovim context", "warning");
				return;
			}
			const md = renderContextMarkdown(latest.data, latest.path);
			if ((args ?? "").trim() === "paste") {
				ctx.ui.setEditorText(
					`Using the latest Neovim context below, help me with this code.\n\n${md}\n\nRequest: `,
				);
				return;
			}
			if (ctx.hasUI && ctx.mode === "tui") {
				const lines = md.split("\n").slice(0, 80);
				await ctx.ui.custom<void>(
					(_tui: any, _theme: any, _kb: any, done: () => void) =>
						new CockpitPanel(lines, done),
					{
						overlay: true,
						overlayOptions: {
							anchor: "center",
							width: "90%",
							maxHeight: "90%",
							margin: 1,
						},
					},
				);
			} else {
				ctx.ui.notify(`Neovim context: ${latest.path}`, "info");
			}
		},
	});

	pi.registerCommand("nvim-refresh", {
		description: "Refresh Neovim cockpit footer/status",
		handler: async (_args, ctx) => {
			const config = await readWorkflowConfig(ctx.cwd);
			await refreshStatus(ctx);
			ctx.ui.notify(
				enabled(config, "piCockpit")
					? "Neovim cockpit refreshed"
					: "Pi cockpit disabled by agent-workflow config",
				enabled(config, "piCockpit") ? "info" : "warning",
			);
		},
	});

	pi.registerTool({
		name: "nvim_context",
		label: "Neovim Context",
		description:
			"Read the latest Neovim editor context exported by the Neovim bridge.",
		promptSnippet:
			"Read the latest Neovim current file/selection/diagnostics context exported by the editor.",
		promptGuidelines: [
			"Use nvim_context when the user refers to the current Neovim file, cursor, selection, diagnostics, or editor state.",
			"Use nvim_context before guessing about code the user says is selected or open in Neovim.",
		],
		parameters: Type.Object({
			includeBody: Type.Optional(
				Type.Boolean({
					description:
						"Include selected/current code context body. Default true.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const config = await readWorkflowConfig(ctx.cwd);
			if (!enabled(config, "neovimCockpit")) {
				return {
					content: [
						{
							type: "text",
							text: "Neovim cockpit disabled by agent-workflow config.",
						},
					],
					details: { found: false, disabled: true },
				};
			}
			const latest = await readNvimContext(ctx.cwd);
			if (!latest.data) {
				return {
					content: [
						{ type: "text", text: latest.error ?? "No Neovim context found." },
					],
					details: { found: false },
				};
			}
			const data = { ...latest.data } as NvimContext;
			if (params.includeBody === false) {
				if (data.selection)
					data.selection = { ...data.selection, text: undefined };
				if (data.context) data.context = { ...data.context, text: undefined };
			}
			const md = renderContextMarkdown(data, latest.path);
			return {
				content: [{ type: "text", text: md }],
				details: { found: true, path: latest.path, context: data },
			};
		},
	});
}
