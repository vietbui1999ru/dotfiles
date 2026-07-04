import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
	currentBranch,
	currentHead,
	gitMainRoot,
	readJsonObject,
} from "./git-helpers";

const execFileAsync = promisify(execFile);

const DOTFILES = resolve(homedir(), "dotfiles");
const TEMPLATE_DIR = join(DOTFILES, "shared", "templates");
const DEFAULT_VAULT = resolve(homedir(), "repos", "Obsidian");
const CONTEXT_START = "<!-- pi:session-context:start -->";
const CONTEXT_END = "<!-- pi:session-context:end -->";
const HISTORY_START = "<!-- pi:history:start -->";
const HISTORY_END = "<!-- pi:history:end -->";
const RECOVERY_START = "<!-- pi:obsidian-recovery:start -->";
const RECOVERY_END = "<!-- pi:obsidian-recovery:end -->";

function stringEnum(values: string[]) {
	return Type.Unsafe({ type: "string", enum: values });
}

const KindSchema = stringEnum([
	"spec",
	"plan",
	"design",
	"arch",
	"pr",
	"review",
	"note",
]);
const ContextModeSchema = stringEnum([
	"snapshot",
	"since-compaction",
	"full",
	"n-entries",
	"none",
]);

type NoteKind = "spec" | "plan" | "design" | "arch" | "pr" | "review" | "note";
type ContextMode =
	| "snapshot"
	| "since-compaction"
	| "full"
	| "n-entries"
	| "none";

interface ObsidianFolders {
	spec?: string;
	plan?: string;
	design?: string;
	arch?: string;
	pr?: string;
	review?: string;
	note?: string;
}

interface WorkflowConfig {
	obsidianBridge?: boolean;
	obsidianCli?: string;
	obsidianVault?: string;
	obsidianVaultName?: string;
	obsidianProjectVaults?: Record<string, string>;
	obsidianFolders?: ObsidianFolders;
	obsidianContextCapture?: boolean;
	obsidianDefaultContextMode?: ContextMode;
	obsidianHistoryLimit?: number;
	obsidianDiffTimeoutMs?: number;
	redactPatterns?: string[];
}

interface CreateNoteParams {
	kind: NoteKind;
	title?: string;
	slug?: string;
	contextMode?: ContextMode;
	entryCount?: number;
	notePath?: string;
	historyLimit?: number;
	includeToolCalls?: boolean;
	includeErrors?: boolean;
	includeCompactionSummaries?: boolean;
	includeDiffViewerArtifact?: boolean;
	openAfter?: boolean;
	vault?: string;
	folder?: string;
	goal?: string;
}

interface NoteResult {
	path: string;
	relPath: string;
	vault: string;
	opened: boolean;
	diffEmbedded: boolean;
	diffStatus: string;
}

async function readWorkflowConfig(cwd: string): Promise<WorkflowConfig> {
	const cfg: Record<string, unknown> = {};
	Object.assign(
		cfg,
		await readJsonObject(
			join(homedir(), ".config", "agent-workflow", "config.json"),
		),
	);
	try {
		const root = await gitMainRoot(cwd);
		Object.assign(
			cfg,
			await readJsonObject(join(root, ".agent-workflow.json")),
		);
		Object.assign(
			cfg,
			await readJsonObject(join(root, ".agent-workflow.local.json")),
		);
	} catch {
		/* ignore */
	}
	return cfg as WorkflowConfig;
}

function defaultFolder(kind: NoteKind): string {
	if (["spec", "design", "arch"].includes(kind)) return "Sessions/Specs";
	if (kind === "plan") return "Sessions/Plans";
	if (["pr", "review"].includes(kind)) return "Sessions/Reviews";
	return "Sessions/Inbox";
}

function slugify(text: string): string {
	const slug = text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
	return slug || "note";
}

function yamlEscape(value: unknown): string {
	if (Array.isArray(value))
		return `[${value.map((x) => JSON.stringify(String(x))).join(", ")}]`;
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(String(value ?? ""));
}

function contentText(content: any): string {
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		return content
			.map((part) => {
				if (typeof part === "string") return part;
				if (part?.type === "text") return part.text || "";
				if (part?.type === "toolCall")
					return `[tool:${part.toolName || part.name || "call"}]`;
				if (part?.type) return `[${part.type}]`;
				return "";
			})
			.filter(Boolean)
			.join("\n");
	}
	return "";
}

function redact(text: string, patterns: string[] = []): string {
	let out = text.replace(
		/(api[_-]?key|token|secret|password)\s*[:=]\s*[^\s`"']+/gi,
		"$1=<redacted>",
	);
	for (const pattern of patterns) {
		if (pattern) out = out.split(pattern).join("<redacted>");
	}
	return out;
}

function truncate(text: string, max = 800): string {
	const clean = text.trim();
	return clean.length > max ? clean.slice(0, max) + "…" : clean;
}

function findLastCompactionIndex(entries: any[]): number {
	for (let i = entries.length - 1; i >= 0; i--) {
		if (["compaction", "branch_summary"].includes(entries[i]?.type)) return i;
	}
	return -1;
}

function branchEntries(
	ctx: any,
	mode: ContextMode,
	entryCount?: number,
): any[] {
	const branch =
		ctx.sessionManager?.getBranch?.() ||
		ctx.sessionManager?.getEntries?.() ||
		[];
	if (mode === "none") return [];
	if (mode === "full") return branch;
	if (mode === "n-entries") return branch.slice(-Math.max(1, entryCount || 30));
	const idx = findLastCompactionIndex(branch);
	return idx >= 0
		? branch.slice(idx)
		: branch.slice(-Math.max(1, entryCount || 30));
}

function summarizeEntries(
	entries: any[],
	cfg: WorkflowConfig,
	params: CreateNoteParams,
): string {
	const decisions: string[] = [];
	const assistant: string[] = [];
	const tools: string[] = [];
	const errors: string[] = [];
	const summaries: string[] = [];
	const labels: string[] = [];
	for (const entry of entries) {
		if (
			entry?.type === "compaction" &&
			params.includeCompactionSummaries !== false
		)
			summaries.push(truncate(entry.summary || "", 1200));
		if (
			entry?.type === "branch_summary" &&
			params.includeCompactionSummaries !== false
		)
			summaries.push(truncate(entry.summary || "", 1200));
		if (entry?.type === "label")
			labels.push(`${entry.label || "label"} → ${entry.targetId || ""}`);
		if (entry?.type !== "message") continue;
		const msg = entry.message || {};
		const text = redact(contentText(msg.content), cfg.redactPatterns);
		if (msg.role === "user" && text) decisions.push(truncate(text, 600));
		else if (msg.role === "assistant" && text)
			assistant.push(truncate(text, 500));
		else if (msg.role === "toolResult") {
			const line = `${msg.toolName || "tool"}${msg.isError ? " ERROR" : ""}: ${truncate(redact(contentText(msg.content), cfg.redactPatterns), 400)}`;
			if (msg.isError) errors.push(line);
			else if (params.includeToolCalls !== false) tools.push(line);
		}
	}
	const section = (title: string, items: string[]) =>
		[
			`### ${title}`,
			items.length
				? items.map((x) => `- ${x.replace(/\n/g, "\n  ")}`).join("\n")
				: "- _(none captured)_",
		].join("\n");
	return [
		section("User asks / decisions", decisions.slice(-12)),
		section("Assistant summaries", assistant.slice(-8)),
		section("Tool calls", tools.slice(-12)),
		section("Errors", params.includeErrors === false ? [] : errors.slice(-10)),
		section("Compaction / branch summaries", summaries.slice(-5)),
		section("Labels", labels.slice(-10)),
	].join("\n\n");
}

async function readTemplate(kind: NoteKind): Promise<string> {
	const path = join(TEMPLATE_DIR, `${kind}.md`);
	try {
		return await readFile(path, "utf8");
	} catch {
		return `## ${kind.toUpperCase()} Template\n\n- Goal:\n- Acceptance criteria:\n- Notes:\n`;
	}
}

function upsertBlock(
	content: string,
	start: string,
	end: string,
	replacement: string,
): string {
	const block = `${start}\n${replacement.trim()}\n${end}`;
	const s = content.indexOf(start);
	const e = content.indexOf(end);
	if (s >= 0 && e > s)
		return content.slice(0, s) + block + content.slice(e + end.length);
	return content.trimEnd() + "\n\n" + block + "\n";
}

function extractHistory(content: string): string[] {
	const s = content.indexOf(HISTORY_START);
	const e = content.indexOf(HISTORY_END);
	if (s < 0 || e <= s) return [];
	return content
		.slice(s + HISTORY_START.length, e)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("- "));
}

function upsertFrontmatter(
	content: string,
	fields: Record<string, unknown>,
): string {
	const lines = Object.entries(fields).map(
		([key, value]) => `${key}: ${yamlEscape(value)}`,
	);
	if (!content.startsWith("---\n"))
		return `---\n${lines.join("\n")}\n---\n\n${content}`;
	const end = content.indexOf("\n---\n", 4);
	if (end < 0) return `---\n${lines.join("\n")}\n---\n\n${content}`;
	const body = content.slice(end + 5);
	const existing = content.slice(4, end).split("\n").filter(Boolean);
	const keys = new Set(Object.keys(fields));
	const kept = existing.filter(
		(line) => !keys.has(line.split(":", 1)[0] || ""),
	);
	return `---\n${[...kept, ...lines].join("\n")}\n---\n${body}`;
}

async function findExistingNote(
	vault: string,
	folder: string,
	slug: string,
): Promise<string | undefined> {
	const dir = join(vault, folder);
	try {
		const items = await readdir(dir);
		const match = items.find(
			(item) => item.endsWith(`${slug}.md`) || item.includes(`_${slug}.md`),
		);
		return match ? join(dir, match) : undefined;
	} catch {
		return undefined;
	}
}

async function latestDiffViewerArtifact(
	cwd: string,
	hint?: string,
): Promise<string | undefined> {
	let root = cwd;
	try {
		root = await gitMainRoot(cwd);
	} catch {
		/* ignore */
	}
	const base = join(root, ".diffviewer", "artifacts");
	if (!existsSync(base)) return undefined;
	const candidates: string[] = [];
	async function walk(dir: string): Promise<void> {
		for (const item of await readdir(dir, { withFileTypes: true })) {
			const path = join(dir, item.name);
			if (item.isDirectory()) await walk(path);
			else if (!hint || path.toLowerCase().includes(hint.toLowerCase()))
				candidates.push(path);
		}
	}
	try {
		await walk(base);
	} catch {
		return undefined;
	}
	return candidates.sort(
		(a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs,
	)[0];
}

async function maybeReadArtifact(
	cwd: string,
	params: CreateNoteParams,
): Promise<string> {
	if (params.kind !== "review" && params.kind !== "pr") return "";
	if (params.includeDiffViewerArtifact === false) return "";
	const artifact = await latestDiffViewerArtifact(
		cwd,
		params.slug || params.title,
	);
	if (!artifact) return "_(No DiffViewer artifact found.)_";
	try {
		const raw = await readFile(artifact, "utf8");
		return `artifact: \`${artifact}\`\n\n\`\`\`${artifact.endsWith(".json") ? "json" : "text"}\n${truncate(raw, 20000)}\n\`\`\``;
	} catch (error) {
		return `artifact: \`${artifact}\`\n\n_read failed: ${String(error)}_`;
	}
}

async function resolveObsidianCli(
	cfg: WorkflowConfig,
): Promise<string | undefined> {
	const candidates = [cfg.obsidianCli, "obsidian", "obsidian-cli"].filter(
		Boolean,
	) as string[];
	for (const cmd of candidates) {
		try {
			await execFileAsync(cmd, ["help"], {
				timeout: 2500,
				maxBuffer: 1024 * 1024,
			});
			return cmd;
		} catch {
			/* try command -v via shell below */
		}
	}
	try {
		const { stdout } = await execFileAsync(
			"zsh",
			["-lc", "command -v obsidian || command -v obsidian-cli"],
			{ timeout: 2500 },
		);
		return stdout.trim() || undefined;
	} catch {
		return undefined;
	}
}

async function runObsidian(
	cfg: WorkflowConfig,
	vault: string,
	args: string[],
	timeout = 5000,
): Promise<{ stdout: string; ok: boolean; error?: string }> {
	const cli = await resolveObsidianCli(cfg);
	if (!cli)
		return {
			stdout: "",
			ok: false,
			error:
				"Obsidian CLI not found. Enable Settings → General → Command line interface in Obsidian 1.12.7+ and restart terminal.",
		};
	try {
		const { stdout } = await execFileAsync(cli, args, {
			cwd: vault,
			timeout,
			maxBuffer: 4 * 1024 * 1024,
		});
		return { stdout, ok: true };
	} catch (error: any) {
		return {
			stdout: error.stdout || "",
			ok: false,
			error: error.stderr || String(error),
		};
	}
}

async function obsidianDiffSection(
	cfg: WorkflowConfig,
	vault: string,
	relPath: string,
	timeoutMs: number,
): Promise<{ text: string; embedded: boolean; status: string }> {
	const commands = [
		`obsidian history path=${JSON.stringify(relPath)}`,
		`obsidian diff path=${JSON.stringify(relPath)} from=1`,
		`obsidian history:open path=${JSON.stringify(relPath)}`,
	];
	const diff = await runObsidian(
		cfg,
		vault,
		["diff", `path=${relPath}`, "from=1"],
		timeoutMs,
	);
	if (diff.ok && diff.stdout.trim()) {
		return {
			embedded: true,
			status: "embedded",
			text: [
				`### Latest File Recovery diff`,
				"```diff",
				truncate(diff.stdout, 12000),
				"```",
				"",
				"### Commands",
				...commands.map((cmd) => `- \`${cmd}\``),
			].join("\n"),
		};
	}
	return {
		embedded: false,
		status: diff.error || "no diff output",
		text: [
			`### Latest File Recovery diff`,
			`_Skipped or unavailable: ${diff.error || "no diff output"}_`,
			"",
			"### Commands",
			...commands.map((cmd) => `- \`${cmd}\``),
		].join("\n"),
	};
}

function projectVault(cwd: string, cfg: WorkflowConfig): string | undefined {
	const entries = cfg.obsidianProjectVaults || {};
	for (const [needle, vault] of Object.entries(entries)) {
		if (cwd.includes(needle))
			return resolve(vault.replace(/^~(?=\/|$)/, homedir()));
	}
	return undefined;
}

function resolveVault(
	cwd: string,
	cfg: WorkflowConfig,
	params: CreateNoteParams,
): string {
	return resolve(
		(
			params.vault ||
			projectVault(cwd, cfg) ||
			cfg.obsidianVault ||
			DEFAULT_VAULT
		).replace(/^~(?=\/|$)/, homedir()),
	);
}

export async function createObsidianNote(
	ctx: any,
	params: CreateNoteParams,
): Promise<NoteResult> {
	const cfg = await readWorkflowConfig(ctx.cwd);
	const kind = params.kind || "note";
	const mode =
		params.contextMode || cfg.obsidianDefaultContextMode || "since-compaction";
	const title =
		params.title ||
		params.slug ||
		params.goal ||
		`${kind} ${new Date().toISOString().slice(0, 10)}`;
	const slug = slugify(params.slug || title);
	const vault = resolveVault(ctx.cwd, cfg, params);
	const folder =
		params.folder || cfg.obsidianFolders?.[kind] || defaultFolder(kind);
	await mkdir(join(vault, folder), { recursive: true });
	const existing = params.notePath
		? resolve(params.notePath)
		: await findExistingNote(vault, folder, slug);
	const filePath =
		existing ||
		join(vault, folder, `${new Date().toISOString().slice(0, 10)}_${slug}.md`);
	const relPath = relative(vault, filePath);
	const entries = branchEntries(ctx, mode, params.entryCount);
	const context = summarizeEntries(entries, cfg, params);
	const template = existing ? "" : await readTemplate(kind);
	const artifact = await maybeReadArtifact(ctx.cwd, params);
	const branch = await currentBranch(ctx.cwd);
	const head = await currentHead(ctx.cwd);
	let content = existing
		? await readFile(existing, "utf8")
		: `# ${title}\n\n## Goal\n\n${params.goal || title}\n\n## Template\n\n${template}\n`;
	const known = {
		kind,
		title,
		created: existing ? undefined : new Date().toISOString(),
		updated: new Date().toISOString(),
		pi_session: ctx.sessionManager?.getSessionFile?.() || "",
		pi_session_id: basename(
			ctx.sessionManager?.getSessionFile?.() || "",
		).replace(/\.jsonl$/, ""),
		cwd: ctx.cwd,
		git_branch: branch || "",
		git_head: head || "",
		worktree_path: ctx.cwd,
		tags: ["pi-session", kind],
	};
	content = upsertFrontmatter(
		content,
		Object.fromEntries(
			Object.entries(known).filter(([, value]) => value !== undefined),
		),
	);
	content = upsertBlock(
		content,
		CONTEXT_START,
		CONTEXT_END,
		`## Session Context\n\nmode: \`${mode}\` • entries: ${entries.length}\n\n${context}\n\n## DiffViewer Artifact\n\n${artifact || "_(not applicable)_"}`,
	);
	const oldHistory = extractHistory(content).slice(
		0,
		Math.max(0, (params.historyLimit ?? cfg.obsidianHistoryLimit ?? 10) - 1),
	);
	const historyLine = `- ${new Date().toISOString()} — ${kind} update — mode=${mode} — branch=${branch || "?"} — head=${head || "?"}`;
	content = upsertBlock(
		content,
		HISTORY_START,
		HISTORY_END,
		`## History\n\n${[historyLine, ...oldHistory].join("\n")}`,
	);
	await writeFile(filePath, content.endsWith("\n") ? content : content + "\n");
	const diff = await obsidianDiffSection(
		cfg,
		vault,
		relPath,
		cfg.obsidianDiffTimeoutMs ?? 3500,
	);
	content = await readFile(filePath, "utf8");
	content = upsertBlock(
		content,
		RECOVERY_START,
		RECOVERY_END,
		`## Obsidian File Recovery\n\n${diff.text}`,
	);
	await writeFile(filePath, content.endsWith("\n") ? content : content + "\n");
	let opened = false;
	if (params.openAfter !== false) {
		const open = await runObsidian(
			cfg,
			vault,
			["open", `path=${relPath}`],
			5000,
		);
		opened = open.ok;
	}
	return {
		path: filePath,
		relPath,
		vault,
		opened,
		diffEmbedded: diff.embedded,
		diffStatus: diff.status,
	};
}

function parseCommandArgs(args: string): CreateNoteParams {
	const parts = (args || "").trim().split(/\s+/).filter(Boolean);
	const kind = (
		["spec", "plan", "design", "arch", "pr", "review", "note"].includes(
			parts[0],
		)
			? parts.shift()
			: "note"
	) as NoteKind;
	let contextMode: ContextMode | undefined;
	let entryCount: number | undefined;
	let openAfter = true;
	const titleParts: string[] = [];
	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		if (part === "--full") contextMode = "full";
		else if (part === "--since-compaction") contextMode = "since-compaction";
		else if (part === "--no-open") openAfter = false;
		else if (part === "--n") {
			contextMode = "n-entries";
			entryCount = Number(parts[++i] || 30);
		} else titleParts.push(part);
	}
	const title = titleParts.join(" ").trim() || undefined;
	return { kind, title, slug: title, contextMode, entryCount, openAfter };
}

function inferIntent(prompt: string): NoteKind | undefined {
	const p = prompt.toLowerCase();
	if (/\b(review|pr review|diff review)\b/.test(p)) return "review";
	if (/\b(plan|planning|implementation plan)\b/.test(p)) return "plan";
	if (/\b(spec|specification|prd)\b/.test(p)) return "spec";
	if (/\bdesign\b/.test(p)) return "design";
	if (/\barch|architecture\b/.test(p)) return "arch";
	return undefined;
}

export default function piObsidian(pi: ExtensionAPI) {
	pi.registerTool({
		name: "obsidian_note",
		label: "Obsidian Note",
		description:
			"Create or update an Obsidian note seeded with current Pi session context.",
		promptSnippet:
			"Create/update an Obsidian note with live Pi session context for specs, plans, PRs, and reviews.",
		promptGuidelines: [
			"Use obsidian_note when starting or materially updating a spec, plan, design, architecture note, PR description, or review so the session context is captured in Obsidian.",
		],
		parameters: Type.Object({
			kind: KindSchema,
			title: Type.Optional(Type.String()),
			slug: Type.Optional(Type.String()),
			contextMode: Type.Optional(ContextModeSchema),
			entryCount: Type.Optional(Type.Number()),
			notePath: Type.Optional(Type.String()),
			historyLimit: Type.Optional(Type.Number()),
			includeToolCalls: Type.Optional(Type.Boolean()),
			includeErrors: Type.Optional(Type.Boolean()),
			includeCompactionSummaries: Type.Optional(Type.Boolean()),
			includeDiffViewerArtifact: Type.Optional(Type.Boolean()),
			openAfter: Type.Optional(Type.Boolean()),
			vault: Type.Optional(Type.String()),
			folder: Type.Optional(Type.String()),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const result = await createObsidianNote(ctx, params as CreateNoteParams);
			return {
				content: [
					{
						type: "text",
						text: `Obsidian note ${result.opened ? "opened" : "written"}: ${result.path}\nDiff: ${result.diffStatus}`,
					},
				],
				details: result,
			};
		},
	});

	pi.registerCommand("obsidian-note", {
		description:
			"Create/update an Obsidian note from this session. Args: [kind] [title] [--full|--since-compaction|--n N] [--no-open]",
		handler: async (args, ctx) => {
			try {
				const result = await createObsidianNote(
					ctx,
					parseCommandArgs(args || ""),
				);
				ctx.ui.notify(
					`Obsidian note: ${result.path}`,
					result.opened ? "info" : "warning",
				);
			} catch (error) {
				ctx.ui.notify(`Obsidian note failed: ${String(error)}`, "warning");
			}
		},
	});

	pi.registerCommand("obsidian-open", {
		description:
			"Open an Obsidian note path. Args: <path-from-vault-or-absolute>",
		handler: async (args, ctx) => {
			const cfg = await readWorkflowConfig(ctx.cwd);
			const vault = resolveVault(ctx.cwd, cfg, { kind: "note" });
			const input = (args || "").trim();
			if (!input)
				return ctx.ui.notify("Usage: /obsidian-open <path>", "warning");
			const relPath = input.startsWith("/") ? relative(vault, input) : input;
			const result = await runObsidian(
				cfg,
				vault,
				["open", `path=${relPath}`],
				5000,
			);
			ctx.ui.notify(
				result.ok ? `Opened ${relPath}` : `Open failed: ${result.error}`,
				result.ok ? "info" : "warning",
			);
		},
	});

	pi.registerCommand("obsidian-update", {
		description:
			"Update an existing Obsidian note with current session context. Args: <absolute-note-path> [--full|--n N]",
		handler: async (args, ctx) => {
			const parts = (args || "").trim().split(/\s+/);
			const notePath = parts.shift();
			if (!notePath)
				return ctx.ui.notify("Usage: /obsidian-update <note-path>", "warning");
			const parsed = parseCommandArgs(["note", ...parts].join(" "));
			const result = await createObsidianNote(ctx, { ...parsed, notePath });
			ctx.ui.notify(`Updated ${result.path}`, "info");
		},
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const cfg = await readWorkflowConfig(ctx.cwd);
		if (cfg.obsidianContextCapture === false) return;
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const kind = inferIntent(event.prompt || "");
		if (!kind) return;
		const ok = await ctx.ui.confirm(
			"Start Obsidian session note?",
			`Detected ${kind} work. Create/update an Obsidian note from current session context?`,
		);
		if (!ok) return;
		try {
			const title = truncate((event.prompt || kind).replace(/\s+/g, " "), 80);
			const result = await createObsidianNote(ctx, {
				kind,
				title,
				slug: title,
				goal: event.prompt,
				contextMode: cfg.obsidianDefaultContextMode || "since-compaction",
			});
			ctx.ui.notify(
				`Obsidian note: ${result.path}`,
				result.opened ? "info" : "warning",
			);
		} catch (error) {
			ctx.ui.notify(`Obsidian capture failed: ${String(error)}`, "warning");
		}
	});
}
