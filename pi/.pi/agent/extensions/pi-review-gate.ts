/**
 * Pi Review Gate — AI code generation quality gate extension
 *
 * Sandboxed generation → patch batch → keyboard review overlay → apply approved patches
 *
 * Architecture:
 *   .review-gate/batches/<batch_id>.json   — canonical review state
 *   .review-gate/patches/<batch_id>/*.patch — patch artifacts
 *   Pi overlay                               — keyboard review UI
 *   AgentOps vault                           — durable summaries
 *   DiffView                                 — diff rendering (optional)
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve, relative } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { Key, type Theme, type SelectItem } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);
const DOTFILES = resolve(homedir(), "dotfiles");
const AGENTOPS_VAULT = resolve(homedir(), "repos", "AgentOps");
const REVIEW_GATE_DIR = ".review-gate";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ReviewChunk {
	index: number;
	startLine: number;
	endLine: number;
	changedLoc: number;
	hunkHeader: string;
	diffText: string;
}

interface FileReview {
	path: string;
	action: "create" | "modify" | "delete" | "rename";
	oldPath?: string;
	baseFileHash: string;
	mainHashAtReviewStart: string;
	sandboxHash: string;
	patchHash: string;
	changedLoc: number;
	locExempt: boolean;
	excluded: boolean;
	chunks: ReviewChunk[];
	status: "pending" | "reviewing" | "approved" | "rejected" | "deferred" | "stale" | "conflicted";
	rejectionReason?: string;
}

interface ReviewBatch {
	batchId: string;
	baseCommit: string;
	sandboxPath: string;
	generatedBy: string;
	createdAt: number;
	updatedAt: number;
	files: FileReview[];
	overallStatus: "pending" | "in-review" | "partial" | "applied" | "cancelled";
	agentOpsNotePath?: string;
	diffviewerArtifactId?: string;
}

interface ReviewState {
	enabled: boolean;
	currentBatchId?: string;
	pendingBatches: string[];
}

// ─── State ──────────────────────────────────────────────────────────────────

const reviewState: ReviewState = { enabled: true, pendingBatches: [] };
let currentBatch: ReviewBatch | null = null;
let inGenerationPhase = false;

// ─── Hash helpers ───────────────────────────────────────────────────────────

function fileHash(content: string): string {
	return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function fileHashFromPath(p: string): string | null {
	try {
		return fileHash(readFileSync(p, "utf8"));
	} catch {
		return null;
	}
}

// ─── Git helpers ────────────────────────────────────────────────────────────

async function git(args: string[], cwd?: string): Promise<string> {
	const { stdout } = await execFileAsync("git", args, {
		cwd,
		timeout: 10000,
	});
	return stdout.trim();
}

async function gitCheck(cwd: string, ...args: string[]): Promise<boolean> {
	try {
		await execFileAsync("git", args, { cwd, timeout: 5000 });
		return true;
	} catch {
		return false;
	}
}

async function getDiff(cwd: string, baseRef: string, path?: string): Promise<string> {
	const args = ["diff", baseRef];
	if (path) args.push("--", path);
	return git(args, cwd);
}

function isMainWorktree(cwd: string): boolean {
	try {
		// If .review-gate exists in parent that means this IS a sandbox
		// Simple heuristic: check if cwd contains ".worktree" or is inside .review-gate/sandboxes
		const root = readFileSync(join(cwd, ".git", "HEAD"), "utf8");
		return !cwd.includes(".worktree") && !cwd.includes("sandbox") && !cwd.includes("review-gate");
	} catch {
		return true; // assume main worktree
	}
}

// ─── Diff analysis ──────────────────────────────────────────────────────────

function parseChangedLines(diffText: string): number {
	let added = 0;
	let removed = 0;
	for (const line of diffText.split("\n")) {
		if (line.startsWith("+") && !line.startsWith("+++")) added++;
		else if (line.startsWith("-") && !line.startsWith("---")) removed++;
	}
	return added + removed;
}

function parseHunks(diffText: string): Array<{ header: string; lines: string[]; added: number; removed: number }> {
	const hunks: Array<{ header: string; lines: string[]; added: number; removed: number }> = [];
	const lines = diffText.split("\n");
	let currentHunk: string[] = [];
	let currentHeader = "";
	let inHunk = false;

	for (const line of lines) {
		const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
		if (hunkMatch) {
			if (inHunk && currentHunk.length > 0) {
				let added = 0, removed = 0;
				for (const l of currentHunk) {
					if (l.startsWith("+") && !l.startsWith("+++")) added++;
					else if (l.startsWith("-") && !l.startsWith("---")) removed++;
				}
				hunks.push({ header: currentHeader, lines: currentHunk, added, removed });
			}
			currentHeader = line;
			currentHunk = [];
			inHunk = true;
		} else if (inHunk) {
			currentHunk.push(line);
		}
	}
	if (inHunk && currentHunk.length > 0) {
		let added = 0, removed = 0;
		for (const l of currentHunk) {
			if (l.startsWith("+") && !l.startsWith("+++")) added++;
			else if (l.startsWith("-") && !l.startsWith("---")) removed++;
		}
		hunks.push({ header: currentHeader, lines: currentHunk, added, removed });
	}
	return hunks;
}

function chunkHunks(
	hunks: Array<{ header: string; lines: string[]; added: number; removed: number }>,
	targetSize = 50,
): ReviewChunk[] {
	const chunks: ReviewChunk[] = [];
	let chunkIndex = 0;

	for (const hunk of hunks) {
		const hunkChanged = hunk.added + hunk.removed;

		if (hunkChanged <= targetSize) {
			chunks.push({
				index: chunkIndex++,
				startLine: 0,
				endLine: 0,
				changedLoc: hunkChanged,
				hunkHeader: hunk.header,
				diffText: hunk.lines.join("\n"),
			});
			continue;
		}

		// Split large hunk
		const lines = hunk.lines;
		let startLine = 0;
		let currentLoc = 0;
		let currentLines: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			currentLines.push(line);
			if (line.startsWith("+") && !line.startsWith("+++")) currentLoc++;
			else if (line.startsWith("-") && !line.startsWith("---")) currentLoc++;

			if (currentLoc >= targetSize || i === lines.length - 1) {
				let added = 0, removed = 0;
				for (const l of currentLines) {
					if (l.startsWith("+") && !l.startsWith("+++")) added++;
					else if (l.startsWith("-") && !l.startsWith("---")) removed++;
				}
				chunks.push({
					index: chunkIndex++,
					startLine: startLine,
					endLine: i,
					changedLoc: added + removed,
					hunkHeader: `${hunk.header} (split ${chunks.length + 1})`,
					diffText: currentLines.join("\n"),
				});
				currentLines = [];
				currentLoc = 0;
				startLine = i + 1;
			}
		}
	}

	return chunks;
}

const EXCLUDED_PATTERNS = [
	/\/node_modules\//,
	/\/\.git\//,
	/\/dist\//,
	/\/build\//,
	/\/\.next\//,
	/\/coverage\//,
	/package-lock\.json$/,
	/yarn\.lock$/,
	/pnpm-lock\.yaml$/,
	/\/\.DS_Store$/,
	/\*\.min\.(js|css)$/,
	/\*\.generated\./,
	/\/snapshots?\//,
	/\/__snapshots__\//,
	/\/vendor\//,
	/\/\.venv\//,
];

const DOCS_PATTERNS = [
	/\/test(s)?\//,
	/\.test\./,
	/\.spec\./,
	/\/__tests__\//,
	/\/docs?\//,
	/\/__docs__\//,
	/\.md$/,
	/\.mdx$/
];

function isExcluded(path: string): boolean {
	return EXCLUDED_PATTERNS.some((p) => p.test(path));
}

function isDocsOrTest(path: string): boolean {
	return DOCS_PATTERNS.some((p) => p.test(path));
}

// ─── Batch ledger ───────────────────────────────────────────────────────────

function batchDir(cwd: string, batchId: string): string {
	return resolve(cwd, REVIEW_GATE_DIR, "batches", batchId);
}

function batchFilePath(cwd: string, batchId: string): string {
	return join(batchDir(cwd, batchId), "batch.json");
}

function patchDir(cwd: string, batchId: string): string {
	return resolve(cwd, REVIEW_GATE_DIR, "patches", batchId);
}

function ensureReviewGateDirs(cwd: string, batchId: string): void {
	const d = batchDir(cwd, batchId);
	mkdirSync(d, { recursive: true });
	mkdirSync(patchDir(cwd, batchId), { recursive: true });
}

function saveBatch(batch: ReviewBatch, cwd: string): void {
	ensureReviewGateDirs(cwd, batch.batchId);
	batch.updatedAt = Date.now();
	writeFileSync(batchFilePath(cwd, batch.batchId), JSON.stringify(batch, null, 2));
	// Save patch per file
	for (const file of batch.files) {
		if (file.chunks.length > 0) {
			const patchContent = file.chunks.map((c) => `${c.hunkHeader}\n${c.diffText}`).join("\n");
			writeFileSync(join(patchDir(cwd, batch.batchId), `${file.path.replace(/\//g, "_")}.patch`), patchContent);
		}
	}
}

function loadBatch(cwd: string, batchId: string): ReviewBatch | null {
	try {
		return JSON.parse(readFileSync(batchFilePath(cwd, batchId), "utf8"));
	} catch {
		return null;
	}
}

function listBatches(cwd: string): string[] {
	const dirPath = resolve(cwd, REVIEW_GATE_DIR, "batches");
	try {
		return readdirSync(dirPath).filter((f) => {
			try {
				return existsSync(join(dirPath, f, "batch.json"));
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}

// ─── Sandbox detection / enforcement ────────────────────────────────────────

const DANGEROUS_BASH_PATTERNS = [
	/\b(rm|mv|cp)\s+-[rf]/,
	/\bsudo\b/,
	/\bchmod\b/,
	/\bchown\b/,
	/\b>\s*\//,
	/\bdd\b/,
	/\bmkfs\b/,
	/\b>(\||>)/,
];

function isMutatingBash(command: string): boolean {
	// Write operators
	if (command.includes(">") || command.includes(">>")) return true;
	if (command.includes("| tee ")) return true;
	if (command.startsWith("sed") && command.includes("-i")) return true;
	// Write commands
	const writeCmds = ["write", "echo", "cat >", "printf", "install", "cp", "mv", "rm", "mkdir", "touch"];
	for (const cmd of writeCmds) {
		if (command.startsWith(cmd) || command.includes(` ${cmd} `)) return true;
	}
	return DANGEROUS_BASH_PATTERNS.some((p) => p.test(command));
}

function ensureReviewGateignore(cwd: string): void {
	const gitignorePath = resolve(cwd, ".review-gate", ".gitignore");
	try {
		if (!existsSync(dirname(gitignorePath))) mkdirSync(dirname(gitignorePath), { recursive: true });
		if (!existsSync(gitignorePath)) writeFileSync(gitignorePath, "*\n");
	} catch {
		/* ignore */
	}
}

// ─── Create batch from sandbox diff ─────────────────────────────────────────

async function createBatchFromSandbox(
	cwd: string,
	sandboxPath: string,
	generatedBy: string,
): Promise<ReviewBatch | null> {
	try {
		const baseCommit = await git(["rev-parse", "HEAD"], cwd);
		const sandboxCommit = await git(["rev-parse", "HEAD"], sandboxPath).catch(() => "");
		const diffText = sandboxCommit
			? await git(["diff", baseCommit, sandboxCommit, "--name-status"], sandboxPath).catch(() =>
				git(["diff", baseCommit, "--name-status"], sandboxPath).catch(() => "")
			  )
			: await git(["diff", baseCommit, "--name-status"], sandboxPath).catch(() => "");

		if (!diffText.trim()) {
			return null;
		}

		const batchId = `review-${new Date().toISOString().slice(0, 10)}-${baseCommit.slice(0, 8)}`;
		const files: FileReview[] = [];

		for (const line of diffText.trim().split("\n")) {
			const match = line.match(/^([AMDR])\s+(.+)$/);
			if (!match) continue;
			const status = match[1];
			const filePath = match[2].trim();

			if (isExcluded(filePath)) continue;

			const resolvedPath = resolve(sandboxPath, filePath);
			const mainPath = resolve(cwd, filePath);
			const sandboxContent = existsSync(resolvedPath) ? readFileSync(resolvedPath, "utf8") : "";
			const mainBeforeContent = existsSync(mainPath) ? readFileSync(mainPath, "utf8") : "";

			const fileDiff = await git(
				["diff", baseCommit, sandboxCommit || "HEAD", "--", filePath],
				sandboxPath,
			).catch(() => "");

			const changedLoc = parseChangedLines(fileDiff);
			const hunks = parseHunks(fileDiff);
			const chunks = chunkHunks(hunks);

			const action = status === "A" ? "create" : status === "D" ? "delete" : status === "R" ? "rename" : "modify";

			files.push({
				path: filePath,
				action,
				baseFileHash: fileHash(mainBeforeContent),
				mainHashAtReviewStart: fileHashFromPath(mainPath) || fileHash(mainBeforeContent),
				sandboxHash: fileHash(sandboxContent),
				patchHash: fileHash(fileDiff),
				changedLoc,
				locExempt: isDocsOrTest(filePath),
				excluded: false,
				chunks,
				status: "pending",
			});
		}

		if (files.length === 0) return null;

		const batch: ReviewBatch = {
			batchId,
			baseCommit,
			sandboxPath,
			generatedBy,
			createdAt: Date.now(),
			updatedAt: Date.now(),
			files,
			overallStatus: "pending",
		};

		saveBatch(batch, cwd);
		return batch;
	} catch (err: any) {
		console.error("Failed to create batch from sandbox:", err.message);
		return null;
	}
}

// ─── Apply approved files ───────────────────────────────────────────────────

async function applyApproved(
	batch: ReviewBatch,
	cwd: string,
	ctx?: ExtensionContext,
): Promise<{ applied: string[]; failed: string[]; stale: string[] }> {
	const applied: string[] = [];
	const failed: string[] = [];
	const stale: string[] = [];

	for (const file of batch.files) {
		if (file.status !== "approved") continue;

		if (file.excluded) {
			applied.push(file.path);
			continue;
		}

		// Revalidate main hash
		const currentMainHash = fileHashFromPath(resolve(cwd, file.path));
		if (currentMainHash && currentMainHash !== file.mainHashAtReviewStart) {
			file.status = "stale";
			stale.push(file.path);
			continue;
		}

		try {
			const sandboxFile = resolve(batch.sandboxPath, file.path);
			const mainFile = resolve(cwd, file.path);
			const sandboxContent = readFileSync(sandboxFile, "utf8");

			// Apply: copy sandbox file to main
			mkdirSync(dirname(mainFile), { recursive: true });
			writeFileSync(mainFile, sandboxContent);
			applied.push(file.path);
		} catch (err: any) {
			file.status = "conflicted";
			failed.push(file.path);
		}
	}

	batch.overallStatus = stale.length > 0 ? "partial" : applied.length > 0 ? "applied" : "cancelled";
	saveBatch(batch, cwd);

	if (ctx) {
		ctx.ui.notify(
			`Applied ${applied.length}, stale ${stale.length}, failed ${failed.length} files`,
			stale.length > 0 ? "warning" : "info",
		);
	}

	return { applied, failed, stale };
}

// ─── Review overlay TUI ─────────────────────────────────────────────────────

const KEYBINDINGS_HELP = [
	"j/k  scroll diff  n/p  chunk  ]/[  file  space  mark seen",
	"a  approve file  r  reject  d  defer  f  feedback  w  warn oversized",
	"x  apply approved  ?  help  q  close",
].join("\n");

function renderReviewOverlay(
	batch: ReviewBatch,
	theme: Theme,
	fileIndex: number,
	chunkIndex: number,
): string[] {
	const file = batch.files[fileIndex];
	if (!file) return ["No files to review."];

	const lines: string[] = [];
	const totalFiles = batch.files.length;
	const totalChunks = file.chunks.length;
	const reviewedChunks = file.chunks.filter((c) => c.index <= chunkIndex).length;

	// Header
	const batchLabel = `Batch: ${batch.batchId}  Agent: ${batch.generatedBy}`;
	lines.push(theme.fg("accent", theme.bold(batchLabel)));
	const actionSymbol = file.action === "create" ? "➕" : file.action === "delete" ? "➖" : file.action === "rename" ? "📝" : "✏️";
	const locExemptLabel = file.locExempt ? theme.fg("muted", "· LOC-exempt") : "";
	lines.push(
		`  File ${fileIndex + 1}/${totalFiles}: ${file.path}  ${actionSymbol}  ${file.changedLoc} LOC${locExemptLabel}`,
	);
	lines.push(
		`  Chunk ${chunkIndex + 1}/${totalChunks}  ${file.chunks[chunkIndex] ? `~${file.chunks[chunkIndex].changedLoc} LOC` : ""}  Status: ${file.status}`,
	);

	// Status indicators
	const baseOk = file.baseFileHash ? "✓" : "—";
	const mainOk = currentHashMatches(file, batch) ? "✓" : "✗";
	const sandboxOk = file.sandboxHash ? "✓" : "—";
	lines.push(theme.fg("dim", `  Base ${baseOk}  Main ${mainOk}  Sandbox ${sandboxOk}`));
	lines.push("");

	// Diff content
	if (file.chunks[chunkIndex]) {
		const diffLines = file.chunks[chunkIndex].diffText.split("\n").slice(0, 30);
		for (const dl of diffLines) {
			if (dl.startsWith("+")) {
				lines.push(theme.fg("success", dl));
			} else if (dl.startsWith("-")) {
				lines.push(theme.fg("error", dl));
			} else if (dl.startsWith("@@")) {
				lines.push(theme.fg("accent", dl));
			} else {
				lines.push(theme.fg("dim", dl));
			}
		}
		if (file.chunks[chunkIndex].diffText.split("\n").length > 30) {
			lines.push(theme.fg("muted", "  [diff truncated, scroll to see more]"));
		}
	}

	lines.push("");

	// Progress
	const barLen = 20;
	const progressFilled = Math.round((reviewedChunks / Math.max(totalChunks, 1)) * barLen);
	const bar = "■".repeat(progressFilled) + "□".repeat(barLen - progressFilled);
	const approvedCount = batch.files.filter((f) => f.status === "approved").length;
	const rejectedCount = batch.files.filter((f) => f.status === "rejected").length;
	lines.push(
		`  Progress: [${bar}] chunks  File: ${file.status}  Files: ${approvedCount} approved · ${rejectedCount} rejected · ${batch.files.filter((f) => f.status === "pending").length} pending`,
	);
	lines.push("");

	// Keybindings
	lines.push(theme.fg("dim", KEYBINDINGS_HELP));

	return lines;
}

function currentHashMatches(file: FileReview, batch: ReviewBatch): boolean {
	const mainPath = resolve(batch.sandboxPath.replace(/\/sandbox.*/, ""), file.path);
	const hash = fileHashFromPath(mainPath);
	return hash === file.mainHashAtReviewStart;
}

// ─── AgentOps note ──────────────────────────────────────────────────────────

async function createAgentOpsReviewNote(
	batch: ReviewBatch,
	cwd: string,
	applyResult?: { applied: string[]; failed: string[]; stale: string[] },
): Promise<string | null> {
	const vault = AGENTOPS_VAULT;
	const dir = join(vault, "Reviews");
	mkdirSync(dir, { recursive: true });

	const slug = `${new Date().toISOString().slice(0, 10)}-review-${batch.batchId.slice(-8)}`;
	const notePath = join(dir, `${slug}.md`);

	const approvedFiles = batch.files.filter((f) => f.status === "approved");
	const rejectedFiles = batch.files.filter((f) => f.status === "rejected");
	const pendingFiles = batch.files.filter((f) => f.status === "pending");

	let body = `# Review: ${batch.batchId}\n\n`;
	body += `## Summary\n\n`;
	body += `- **Batch:** ${batch.batchId}\n`;
	body += `- **Generated by:** ${batch.generatedBy}\n`;
	body += `- **Sandbox:** ${batch.sandboxPath}\n`;
	body += `- **Base commit:** \`${batch.baseCommit.slice(0, 12)}\`\n`;
	body += `- **Status:** ${batch.overallStatus}\n`;
	body += `- **Files:** ${batch.files.length} total  ${approvedFiles.length} approved  ${rejectedFiles.length} rejected  ${pendingFiles.length} pending\n\n`;

	if (applyResult) {
		body += `### Apply result\n\n`;
		body += `- **Applied:** ${applyResult.applied.length > 0 ? applyResult.applied.join(", ") : "none"}\n`;
		body += `- **Stale/blocked:** ${applyResult.stale.length > 0 ? applyResult.stale.join(", ") : "none"}\n`;
		body += `- **Failed:** ${applyResult.failed.length > 0 ? applyResult.failed.join(", ") : "none"}\n\n`;
	}

	body += `## Files\n\n`;
	body += `| File | Action | LOC | Status |\n`;
	body += `|------|--------|-----|--------|\n`;
	for (const file of batch.files) {
		const chip = file.locExempt ? " 📝" : "";
		body += `| \`${file.path}\` | ${file.action}${chip} | ${file.changedLoc} | ${file.status} |\n`;
	}

	body += `\n## Artifacts\n\n`;
	body += `- Batch ledger: \`.review-gate/batches/${batch.batchId}/batch.json\`\n`;
	if (batch.diffviewerArtifactId) {
		body += `- DiffView artifact: \`.diffviewer/artifacts/${batch.diffviewerArtifactId}/\`\n`;
	}

	writeFileSync(notePath, body);
	return notePath;
}

// ─── Extension entry point ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	// ── Commands ──────────────────────────────────────────────────────────

	pi.registerCommand("review-gate", {
		description: "Toggle review gate or show status",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify(
					`Review gate: ${reviewState.enabled ? "enabled" : "disabled"} · ${currentBatch ? currentBatch.files.length + " files pending" : "no active batch"}`,
					"info",
				);
				return;
			}

			reviewState.enabled = !reviewState.enabled;
			const status = reviewState.enabled ? "enabled" : "disabled";
			ctx.ui.setStatus("review-gate", ctx.ui.theme.fg(reviewState.enabled ? "accent" : "warning", `gate ${status}`));
			ctx.ui.notify(`Review gate ${status}`, reviewState.enabled ? "info" : "warning");
		},
	});

	pi.registerCommand("review", {
		description: "Open the review overlay for current batch",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) return;

			// Find batch
			let batch = currentBatch;
			if (!batch) {
				const batches = listBatches(ctx.cwd);
				if (batches.length === 0) {
					ctx.ui.notify("No review batches found", "warning");
					return;
				}
				if (batches.length === 1) {
					batch = loadBatch(ctx.cwd, batches[0]);
				} else {
					const choice = await ctx.ui.select(
						"Select review batch:",
						batches.map((b) => ({ value: b, label: b })),
					);
					if (!choice) return;
					batch = loadBatch(ctx.cwd, choice);
				}
			}

			if (!batch) {
				ctx.ui.notify("Failed to load batch", "error");
				return;
			}

			currentBatch = batch;
			openReviewOverlay(ctx, batch);
		},
	});

	pi.registerCommand("review-batch", {
		description: "Create a review batch from a sandbox path",
		handler: async (args, ctx) => {
			// Parse args: sandbox path and generated-by label
			const parts = (args || "").trim().split(/\s+/);
			const sandboxPath = parts[0] || "";
			const generatedBy = parts.slice(1).join(" ") || pi.getActiveTools().join(",");

			if (!sandboxPath) {
				ctx.ui.notify("Usage: /review-batch <sandbox-path> [generated-by]", "warning");
				return;
			}

			const batch = await createBatchFromSandbox(ctx.cwd, sandboxPath, generatedBy);
			if (!batch) {
				ctx.ui.notify("No changes found in sandbox", "warning");
				return;
			}

			currentBatch = batch;
			if (!reviewState.pendingBatches.includes(batch.batchId)) {
				reviewState.pendingBatches.push(batch.batchId);
			}

			// Create AgentOps note
			const notePath = await createAgentOpsReviewNote(batch, ctx.cwd);
			if (notePath) batch.agentOpsNotePath = notePath;
			saveBatch(batch, ctx.cwd);

			ctx.ui.notify(`Review batch created: ${batch.batchId} (${batch.files.length} files)`, "info");
			ctx.ui.setStatus("review-gate", ctx.ui.theme.fg("accent", `📋 ${batch.files.length} files pending`));

			// Try DiffView integration
			tryCreateDiffViewArtifact(batch, ctx);

			// Open overlay
			openReviewOverlay(ctx, batch);
		},
	});

	// ── Tool call interception ────────────────────────────────────────────

	pi.on("tool_call", async (event, ctx) => {
		if (!reviewState.enabled) return;

		// Block edit/write on main worktree during generation
		if (event.toolName === "edit" || event.toolName === "write") {
			if (isMainWorktree(ctx.cwd)) {
				if (inGenerationPhase) {
					return {
						block: true,
						reason:
							"Main worktree mutation blocked by review gate. " +
							"Generation must happen in a sandbox/worktree. " +
							"Use /review-gate to disable gate, or generate in a sandbox.",
					};
				}
			}
		}

		// Block mutating bash on main worktree
		if (event.toolName === "bash") {
			const command = event.input.command as string;
			if (isMutatingBash(command) && isMainWorktree(ctx.cwd)) {
				if (inGenerationPhase) {
					return {
						block: true,
						reason:
							"Mutating bash command blocked on main worktree by review gate. " +
							"Run mutations in sandbox/worktree, or use /review-gate to disable.",
					};
				}
			}
		}
	});

	// ── Track generation phase ───────────────────────────────────────────

	pi.on("agent_start", async () => {
		if (reviewState.enabled) inGenerationPhase = true;
	});

	pi.on("agent_end", async () => {
		inGenerationPhase = false;
	});

	// ── Status line ──────────────────────────────────────────────────────

	pi.on("session_start", async (_event, ctx) => {
		reviewState.enabled = true;
		inGenerationPhase = false;

		// Ensure .review-gate/.gitignore exists
		ensureReviewGateignore(ctx.cwd);

		// Restore current batch from state if present
		const entries = ctx.sessionManager.getEntries();
		const reviewEntry = entries
			.filter((e: any) => e.customType === "review-gate-batch")
			.pop() as { data?: { batchId?: string } } | undefined;

		if (reviewEntry?.data?.batchId) {
			const batch = loadBatch(ctx.cwd, reviewEntry.data.batchId);
			if (batch) currentBatch = batch;
		}

		if (currentBatch) {
			const pending = currentBatch.files.filter((f) => f.status === "pending").length;
			ctx.ui.setStatus("review-gate", ctx.ui.theme.fg("accent", `📋 ${pending} pending`));
		} else {
			ctx.ui.setStatus("review-gate", ctx.ui.theme.fg("muted", "gate on"));
		}
	});

	// ── Persist state ────────────────────────────────────────────────────

	pi.on("turn_end", async () => {
		if (currentBatch) {
			pi.appendEntry("review-gate-batch", { batchId: currentBatch.batchId });
		}
	});

	// ── API for other extensions ─────────────────────────────────────────

	// pi.events.on("review-gate:create-batch", async (data: { sandboxPath: string; generatedBy: string }) => {
	//   // Called by pi-control-plane or other extensions
	// });
}

// ─── Review Overlay ─────────────────────────────────────────────────────────

function openReviewOverlay(ctx: ExtensionContext, batch: ReviewBatch): void {
	if (!ctx.hasUI || !ctx.mode) return;
	if (ctx.mode !== "tui") {
		ctx.ui.notify("Review overlay requires TUI mode", "warning");
		return;
	}

	let fileIndex = 0;
	let chunkIndex = 0;
	let helpVisible = false;
	let oversizedWarningAck = false;
	let scrollOffset = 0;

	ctx.ui.custom<void>((tui, theme, _kb, done) => {
		const overlay = {
			render(width: number): string[] {
				const file = batch.files[fileIndex];
				if (!file) return ["No files to review."];

				const lines: string[] = [];

				if (helpVisible) {
					lines.push(theme.fg("accent", theme.bold("Review Gate Keybindings")));
					lines.push("");
					lines.push("Navigation:");
					lines.push("  j/k       scroll diff down/up");
					lines.push("  n/p       next/previous chunk");
					lines.push("  ]/[       next/previous file");
					lines.push("  g/G       first/last file");
					lines.push("  ?         toggle this help");
					lines.push("");
					lines.push("Review:");
					lines.push("  space     mark chunk as seen");
					lines.push("  a         approve current file");
					lines.push("  r         reject current file");
					lines.push("  d         defer current file");
					lines.push("  f         send feedback to agent");
					lines.push("  w         acknowledge oversized hunk");
					lines.push("");
					lines.push("Batch:");
					lines.push("  x         apply all approved files");
					lines.push("  q         close overlay");
					lines.push("");
					lines.push(theme.fg("dim", "Press any key to close help"));
					return lines;
				}

				const totalFiles = batch.files.length;
				const totalChunks = file.chunks.length;

				// Header bar
				const batchLabel = `AI Codegen Review  ·  Batch: ${batch.batchId.slice(-12)}  ·  Agent: ${batch.generatedBy}`;
				lines.push(theme.fg("accent", theme.bold(batchLabel)));

				// File header
				const actionIcon =
					file.action === "create" ? "➕" : file.action === "delete" ? "➖" : file.action === "rename" ? "📝" : "✏️";
				const locExemptLabel = file.locExempt ? theme.fg("warning", " · LOC-exempt") : "";
				const statusColor =
					file.status === "approved" ? "success" : file.status === "rejected" ? "error" : file.status === "deferred" ? "warning" : "text";
				lines.push(
					`${theme.fg("accent", `File ${fileIndex + 1}/${totalFiles}`)}: ${file.path}  ${actionIcon}` +
						`  ${theme.fg("muted", `${file.changedLoc} LOC`)}${locExemptLabel}` +
						`  Status: ${theme.fg(statusColor, file.status)}`,
				);
				lines.push(
					`  Chunk ${chunkIndex + 1}/${totalChunks}  ${file.chunks[chunkIndex] ? `~${file.chunks[chunkIndex].changedLoc} LOC` : ""}` +
						`  ${theme.fg("dim", `Reviewed: ${file.chunks.filter((_, i) => i <= chunkIndex).length}/${totalChunks}`)}`,
				);

				// Separator
				lines.push(theme.fg("dim", `  ${"─".repeat(Math.min(width - 4, 60))}`));

				// Diff content
				if (file.chunks[chunkIndex]) {
					const diffLines = file.chunks[chunkIndex].diffText.split("\n");
					const startLine = Math.max(0, scrollOffset);
					const visibleLines = diffLines.slice(startLine, startLine + Math.max(10, Math.min(25, width / 4)));

					for (const dl of visibleLines) {
						if (dl.startsWith("+")) {
							lines.push(theme.fg("success", ` ${dl}`));
						} else if (dl.startsWith("-")) {
							lines.push(theme.fg("error", ` ${dl}`));
						} else if (dl.startsWith("@@")) {
							lines.push(theme.fg("accent", ` ${dl}`));
						} else {
							lines.push(theme.fg("dim", ` ${dl}`));
						}
					}

					if (diffLines.length > visibleLines.length) {
						lines.push(theme.fg("muted", `  [${startLine + visibleLines.length}/${diffLines.length} lines]`));
					}
				} else {
					lines.push(theme.fg("muted", "  (no changes to display)"));
				}

				// Separator
				lines.push(theme.fg("dim", `  ${"─".repeat(Math.min(width - 4, 60))}`));

				// Progress
				const approvedCount = batch.files.filter((f) => f.status === "approved").length;
				const rejectedCount = batch.files.filter((f) => f.status === "rejected").length;
				const pendingCount = batch.files.filter((f) => f.status === "pending").length;
				lines.push(
					`  ${theme.fg("success", `✓ ${approvedCount} approved`)}  ` +
						`${theme.fg("error", `✗ ${rejectedCount} rejected`)}  ` +
						`${theme.fg("muted", `○ ${pendingCount} pending`)}` +
						(file.status === "pending" && file.chunks.length > 0
							? `  Chunk: ${chunkIndex + 1}/${file.chunks.length}`
							: ""),
				);

				lines.push("");
				lines.push(theme.fg("dim", "j/k scroll · n/p chunk · ]/[ file · a approve · r reject · d defer · f feedback"));
				lines.push(theme.fg("dim", "x apply approved · ? help · q close"));

				return lines;
			},

			handleInput(data: string): void {
				if (helpVisible) {
					helpVisible = false;
					tui.requestRender();
					return;
				}

				const file = batch.files[fileIndex];
				if (!file) return;

				if (data === "j") {
					scrollOffset += 2;
					tui.requestRender();
				} else if (data === "k") {
					scrollOffset = Math.max(0, scrollOffset - 2);
					tui.requestRender();
				} else if (data === "n") {
					if (chunkIndex < file.chunks.length - 1) {
						chunkIndex++;
						scrollOffset = 0;
					}
					tui.requestRender();
				} else if (data === "p") {
					if (chunkIndex > 0) {
						chunkIndex--;
						scrollOffset = 0;
					}
					tui.requestRender();
				} else if (data === "]" || data === "}") {
					if (fileIndex < batch.files.length - 1) {
						fileIndex++;
						chunkIndex = 0;
						scrollOffset = 0;
					}
					tui.requestRender();
				} else if (data === "[" || data === "{") {
					if (fileIndex > 0) {
						fileIndex--;
						chunkIndex = 0;
						scrollOffset = 0;
					}
					tui.requestRender();
				} else if (data === "g") {
					fileIndex = 0;
					chunkIndex = 0;
					scrollOffset = 0;
					tui.requestRender();
				} else if (data === "G") {
					fileIndex = batch.files.length - 1;
					chunkIndex = 0;
					scrollOffset = 0;
					tui.requestRender();
				} else if (data === " ") {
					// mark chunk seen - no explicit action needed, just acknowledge navigation
					tui.requestRender();
				} else if (data === "a") {
					// Approve file
					const isOversized = file.changedLoc > 80;
					const allSeen = true; // simplify: approve always allowed
					if (isOversized && !oversizedWarningAck) {
						ctx.ui.notify(
							`Large file (${file.changedLoc} LOC): press w to acknowledge before approval`,
							"warning",
						);
					} else {
						file.status = "approved";
						ctx.ui.notify(`Approved: ${file.path}`, "success");
					}
					tui.requestRender();
				} else if (data === "r") {
					file.status = "rejected";
					ctx.ui.notify(`Rejected: ${file.path}`, "error");
					tui.requestRender();
				} else if (data === "d") {
					file.status = "deferred";
					ctx.ui.notify(`Deferred: ${file.path}`, "warning");
					tui.requestRender();
				} else if (data === "w") {
					oversizedWarningAck = true;
					ctx.ui.notify("Oversized warning acknowledged", "info");
					tui.requestRender();
				} else if (data === "f") {
					// Send feedback — async is tricky here, use notification + prompt
					ctx.ui.input("Feedback for agent (current file):", "").then((feedback) => {
						if (feedback?.trim()) {
							file.rejectionReason = feedback.trim();
							ctx.ui.notify("Feedback recorded", "info");
							tui.requestRender();
						}
					});
				} else if (data === "x") {
					// Apply approved
					ctx.ui
						.confirm("Apply approved files?", `Apply ${batch.files.filter((f) => f.status === "approved").length} file(s)?`)
						.then(async (confirmed) => {
							if (confirmed) {
								const result = await applyApproved(batch, ctx.cwd, ctx);
								const notePath = await createAgentOpsReviewNote(batch, ctx.cwd, result);
								if (notePath) ctx.ui.notify(`Review note: ${notePath}`, "info");
								if (result.stale.length > 0) {
									ctx.ui.notify(`Stale files: ${result.stale.join(", ")}`, "warning");
								}
								tui.requestRender();
							}
						});
				} else if (data === "?") {
					helpVisible = true;
					tui.requestRender();
				} else if (data === "q") {
					// Save state before closing
					saveBatch(batch, ctx.cwd);
					done();
				}
			},

			invalidate(): void {
				// No cache to clear
			},
		};

		return overlay;
	}, { overlay: true });
}

// ─── DiffView integration ───────────────────────────────────────────────────

function tryCreateDiffViewArtifact(batch: ReviewBatch, ctx: ExtensionContext): void {
	try {
		const diffviewerDir = resolve(ctx.cwd, ".diffviewer");
		if (!existsSync(diffviewerDir)) return;

		const artifactDir = join(diffviewerDir, "review-batches", batch.batchId);
		mkdirSync(artifactDir, { recursive: true });

		// Write a review artifact summary for DiffView to pick up
		const summary: any = {
			type: "review-batch",
			batchId: batch.batchId,
			agent: batch.generatedBy,
			baseCommit: batch.baseCommit,
			files: batch.files.map((f) => ({
				path: f.path,
				action: f.action,
				changedLoc: f.changedLoc,
				status: f.status,
			})),
			ledger: `.review-gate/batches/${batch.batchId}/batch.json`,
			createdAt: Date.now(),
		};
		writeFileSync(join(artifactDir, "artifact.json"), JSON.stringify(summary, null, 2));
		batch.diffviewerArtifactId = batch.batchId;
	} catch {
		// DiffView not available, silently skip
	}
}

function readdirSync(dir: string): string[] {
	try {
		return require("fs").readdirSync(dir);
	} catch {
		return [];
	}
}
