/**
 * Pi Review Gate — AI code generation quality gate extension
 *
 * Sandboxed generation → patch batch → keyboard review overlay → apply approved patches
 *
 * Architecture:
 *   .review-gate/batches/<batch_id>.json   — canonical review state
 *   .review-gate/patches/<batch_id>/*.patch — patch artifacts
 *   Pi overlay                               — keyboard review UI
 *   DiffView                                 — diff rendering (optional)
 */

import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import {
	existsSync,
	readFileSync,
	writeFileSync,
	mkdirSync,
	readdirSync,
	lstatSync,
	realpathSync,
	rmSync,
} from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import {
	basename,
	dirname,
	isAbsolute,
	join,
	relative,
	resolve,
	sep,
} from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import { createHash, randomUUID } from "node:crypto";
import {
	Key,
	matchesKey,
	truncateToWidth,
	visibleWidth,
	type Theme,
	type SelectItem,
} from "@earendil-works/pi-tui";
import {
	closeNvimDiff,
	resolveNvimProjectRoot,
	showNvimDiff,
	type NvimPreviewAction,
} from "./lib/nvim-rpc.ts";
import {
	evaluateAutoReview,
} from "./lib/review-auto-policy.ts";
import {
	runVerification,
	type VerificationReport,
} from "./post-run-verifier.ts";
import {
	REVIEW_GATE_BEGIN_PUBLICATION_EVENT,
	REVIEW_GATE_BEGIN_REPLACEMENT_EVENT,
	REVIEW_GATE_END_PUBLICATION_EVENT,
	REVIEW_GATE_RESUME_EVENT,
	REVIEW_GATE_SUSPEND_EVENT,
	REVIEW_GATE_VALIDATE_EVENT,
	ReviewGateSuspensionController,
	SyncControlRequest,
	suspendFailure,
	type ReviewGateControlResult,
	type ReviewGateEndPublicationPayload,
	type ReviewGatePublicationResult,
	type ReviewGateResumePayload,
	type ReviewGateSuspendPayload,
	type ReviewGateSuspendResult,
	type ReviewGateTokenPayload,
} from "./lib/review-gate-suspension.ts";

const execFileAsync = promisify(execFile);
const DOTFILES = resolve(homedir(), "dotfiles");
const REVIEW_GATE_DIR = ".review-gate";
const IS_SUBAGENT_SESSION = process.env.PI_SUBAGENT_CHILD === "1";
const AUTO_APPLY_ENABLED = process.env.PI_REVIEW_GATE_AUTO_APPLY !== "0";
const RETENTION_DAYS = Math.max(
	1,
	Number.parseInt(process.env.PI_REVIEW_GATE_RETENTION_DAYS ?? "7", 10) || 7,
);

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
	mainExistsAtReviewStart?: boolean;
	destinationHashAtReviewStart?: string;
	destinationExistsAtReviewStart?: boolean;
	sandboxHash: string;
	patchHash: string;
	changedLoc: number;
	locExempt: boolean;
	excluded: boolean;
	chunks: ReviewChunk[];
	status:
		| "pending"
		| "reviewing"
		| "approved"
		| "rejected"
		| "deferred"
		| "stale"
		| "conflicted";
	rejectionReason?: string;
	oversizedAck?: boolean;
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
	autoReview?: {
		decision: "queued" | "eligible" | "blocked" | "applied";
		reasons: string[];
		verificationStatus?: VerificationReport["status"];
	};
	diffviewerArtifactId?: string;
	nvimDecisionOffset?: number;
}

interface ReviewState {
	enabled: boolean;
	currentBatchId?: string;
	pendingBatches: string[];
}

// ─── State ──────────────────────────────────────────────────────────────────

const reviewState: ReviewState = {
	enabled: !IS_SUBAGENT_SESSION,
	pendingBatches: [],
};
let currentBatch: ReviewBatch | null = null;
let inGenerationPhase = false;
let reviewMutationActive = false;
let batchMutationVersion = 0;
const reviewSuspension = new ReviewGateSuspensionController((enabled) => {
	reviewState.enabled = enabled;
});

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

function safeProjectPath(root: string, filePath: string): string {
	if (isAbsolute(filePath))
		throw new Error(`Absolute review path: ${filePath}`);
	const rootPath = resolve(root);
	const targetPath = resolve(rootPath, filePath);
	const lexical = relative(rootPath, targetPath);
	if (
		lexical === ".." ||
		lexical.startsWith(`..${sep}`) ||
		isAbsolute(lexical)
	) {
		throw new Error(`Review path escapes project: ${filePath}`);
	}

	const realRoot = realpathSync(rootPath);
	let ancestor = existsSync(targetPath) ? targetPath : dirname(targetPath);
	while (!existsSync(ancestor) && ancestor !== dirname(ancestor)) {
		ancestor = dirname(ancestor);
	}
	const realAncestor = realpathSync(ancestor);
	const resolved = relative(realRoot, realAncestor);
	if (
		resolved === ".." ||
		resolved.startsWith(`..${sep}`) ||
		isAbsolute(resolved)
	) {
		throw new Error(
			`Review path crosses a symlink outside project: ${filePath}`,
		);
	}
	return targetPath;
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

async function getDiff(
	cwd: string,
	baseRef: string,
	path?: string,
): Promise<string> {
	const args = ["diff", baseRef];
	if (path) args.push("--", path);
	return git(args, cwd);
}

function isMainWorktree(cwd: string): boolean {
	try {
		const gitMarker = lstatSync(join(cwd, ".git"));
		// Linked git worktrees use a .git file that points into the main
		// repository. They are the review gate's intended mutation sandbox.
		if (gitMarker.isFile()) return false;
		return (
			!cwd.includes(".worktree") &&
			!cwd.includes("sandbox") &&
			!cwd.includes("review-gate")
		);
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

function parseHunks(
	diffText: string,
): Array<{ header: string; lines: string[]; added: number; removed: number }> {
	const hunks: Array<{
		header: string;
		lines: string[];
		added: number;
		removed: number;
	}> = [];
	const lines = diffText.split("\n");
	let currentHunk: string[] = [];
	let currentHeader = "";
	let inHunk = false;

	for (const line of lines) {
		const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
		if (hunkMatch) {
			if (inHunk && currentHunk.length > 0) {
				let added = 0,
					removed = 0;
				for (const l of currentHunk) {
					if (l.startsWith("+") && !l.startsWith("+++")) added++;
					else if (l.startsWith("-") && !l.startsWith("---")) removed++;
				}
				hunks.push({
					header: currentHeader,
					lines: currentHunk,
					added,
					removed,
				});
			}
			currentHeader = line;
			currentHunk = [];
			inHunk = true;
		} else if (inHunk) {
			currentHunk.push(line);
		}
	}
	if (inHunk && currentHunk.length > 0) {
		let added = 0,
			removed = 0;
		for (const l of currentHunk) {
			if (l.startsWith("+") && !l.startsWith("+++")) added++;
			else if (l.startsWith("-") && !l.startsWith("---")) removed++;
		}
		hunks.push({ header: currentHeader, lines: currentHunk, added, removed });
	}
	return hunks;
}

function chunkHunks(
	hunks: Array<{
		header: string;
		lines: string[];
		added: number;
		removed: number;
	}>,
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
				let added = 0,
					removed = 0;
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

interface SplitDiffRow {
	before: string;
	after: string;
}

function splitDiffRows(diffText: string): SplitDiffRow[] {
	const rows: SplitDiffRow[] = [];
	let removed: string[] = [];
	let added: string[] = [];
	const flushChanges = () => {
		const count = Math.max(removed.length, added.length);
		for (let index = 0; index < count; index++) {
			rows.push({ before: removed[index] ?? "", after: added[index] ?? "" });
		}
		removed = [];
		added = [];
	};

	for (const line of diffText.split("\n")) {
		if (line.startsWith("-") && !line.startsWith("---")) {
			removed.push(line);
		} else if (line.startsWith("+") && !line.startsWith("+++")) {
			added.push(line);
		} else {
			flushChanges();
			rows.push({ before: line, after: line });
		}
	}
	flushChanges();
	return rows;
}

function reviewViewportRows(): number {
	return Math.max(8, Math.min(28, (process.stdout.rows || 40) - 16));
}

function styleDiffLine(line: string, theme: Theme): string {
	if (!line) return "";
	if (line.startsWith("+")) return theme.fg("success", ` ${line}`);
	if (line.startsWith("-")) return theme.fg("error", ` ${line}`);
	if (line.startsWith("@@")) return theme.fg("accent", ` ${line}`);
	return theme.fg("dim", ` ${line}`);
}

function padDiffPane(text: string, width: number): string {
	const truncated = truncateToWidth(text, width);
	return truncated + " ".repeat(Math.max(0, width - visibleWidth(truncated)));
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
	/\.min\.(js|css)$/,
	/\.generated\./,
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
	/\.mdx$/,
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

const REVIEW_BATCH_LIMIT = 500;
const VALID_OVERALL_STATUSES = new Set<ReviewBatch["overallStatus"]>([
	"pending",
	"in-review",
	"partial",
	"applied",
	"cancelled",
]);
const VALID_FILE_STATUSES = new Set<FileReview["status"]>([
	"pending",
	"reviewing",
	"approved",
	"rejected",
	"deferred",
	"stale",
	"conflicted",
]);
const UNRESOLVED_FILE_STATUSES = new Set<FileReview["status"]>([
	"pending",
	"reviewing",
	"deferred",
	"stale",
	"conflicted",
]);

function withReviewMutation<T>(operation: string, callback: () => T): T {
	if (reviewMutationActive) throw new Error(`Review state is busy: ${operation}`);
	if (reviewSuspension.isActive()) throw new Error("Review state is suspended for clear-context");
	reviewMutationActive = true;
	try {
		return callback();
	} finally {
		reviewMutationActive = false;
	}
}

function isValidBatch(batch: ReviewBatch): boolean {
	return Boolean(
		batch &&
		typeof batch.batchId === "string" &&
		VALID_OVERALL_STATUSES.has(batch.overallStatus) &&
		Array.isArray(batch.files) &&
		batch.files.every((file) => file && VALID_FILE_STATUSES.has(file.status)),
	);
}

function isUnresolvedBatch(batch: ReviewBatch): boolean {
	if (batch.overallStatus === "applied") {
		return batch.files.some((file) => UNRESOLVED_FILE_STATUSES.has(file.status));
	}
	if (batch.overallStatus === "cancelled") {
		return batch.files.some((file) => file.status !== "rejected");
	}
	return true;
}

function reconcilePendingBatches(cwd: string):
	| { ok: true; unresolved: string[] }
	| { ok: false; error: string } {
	const dirPath = resolve(cwd, REVIEW_GATE_DIR, "batches");
	let entries;
	try {
		entries = readdirSync(dirPath, { withFileTypes: true });
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			reviewState.pendingBatches = [];
			currentBatch = null;
			return { ok: true, unresolved: [] };
		}
		return { ok: false, error: `Could not enumerate review batches: ${String(error)}` };
	}
	if (entries.length > REVIEW_BATCH_LIMIT) {
		return { ok: false, error: `Review batch count exceeds ${REVIEW_BATCH_LIMIT}` };
	}
	const invalidEntry = entries.find((entry) => !entry.isDirectory());
	if (invalidEntry) return { ok: false, error: `Unexpected review batch entry: ${invalidEntry.name}` };
	const unresolved: string[] = [];
	const loaded = new Map<string, ReviewBatch>();
	for (const entry of entries) {
		const path = join(dirPath, entry.name, "batch.json");
		if (!existsSync(path)) return { ok: false, error: `Review batch is missing batch.json: ${entry.name}` };
		let batch: ReviewBatch;
		try {
			const stat = lstatSync(path);
			if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) {
				return { ok: false, error: `Review batch file is unsafe or oversized: ${entry.name}` };
			}
			batch = JSON.parse(readFileSync(path, "utf8")) as ReviewBatch;
		} catch {
			return { ok: false, error: `Review batch is unreadable: ${entry.name}` };
		}
		if (!isValidBatch(batch) || batch.batchId !== entry.name) {
			return { ok: false, error: `Review batch is invalid: ${entry.name}` };
		}
		loaded.set(entry.name, batch);
		if (isUnresolvedBatch(batch)) unresolved.push(entry.name);
	}
	reviewState.pendingBatches = unresolved;
	if (currentBatch) {
		const persisted = loaded.get(currentBatch.batchId);
		if (!persisted || !isUnresolvedBatch(persisted)) currentBatch = null;
	}
	return { ok: true, unresolved };
}

function saveBatch(batch: ReviewBatch, cwd: string): void {
	withReviewMutation("save batch", () => {
		ensureReviewGateDirs(cwd, batch.batchId);
		batch.updatedAt = Date.now();
		writeFileSync(
			batchFilePath(cwd, batch.batchId),
			JSON.stringify(batch, null, 2),
		);
		for (const file of batch.files) {
			if (file.chunks.length > 0) {
				const patchContent = file.chunks
					.map((chunk) => `${chunk.hunkHeader}\n${chunk.diffText}`)
					.join("\n");
				writeFileSync(
					join(
						patchDir(cwd, batch.batchId),
						`${file.path.replace(/\//g, "_")}.patch`,
					),
					patchContent,
				);
			}
		}
		batchMutationVersion += 1;
		reconcilePendingBatches(cwd);
	});
}

function loadBatch(cwd: string, batchId: string): ReviewBatch | null {
	try {
		const batch = JSON.parse(readFileSync(batchFilePath(cwd, batchId), "utf8")) as ReviewBatch;
		return isValidBatch(batch) ? batch : null;
	} catch {
		return null;
	}
}

function listBatches(cwd: string): string[] {
	const dirPath = resolve(cwd, REVIEW_GATE_DIR, "batches");
	try {
		return readdirSync(dirPath).filter((file) => {
			try {
				return existsSync(join(dirPath, file, "batch.json"));
			} catch {
				return false;
			}
		});
	} catch {
		return [];
	}
}

function pruneSettledBatches(cwd: string): number {
	const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1_000;
	let removed = 0;
	for (const batchId of listBatches(cwd)) {
		const batch = loadBatch(cwd, batchId);
		if (!batch) continue;
		if (batch.overallStatus !== "applied" && batch.overallStatus !== "cancelled")
			continue;
		if (batch.updatedAt > cutoff) continue;
		try {
			rmSync(batchDir(cwd, batchId), { recursive: true, force: true });
			rmSync(patchDir(cwd, batchId), { recursive: true, force: true });
			removed++;
		} catch {
			// Retention cleanup is best-effort and must never affect review decisions.
		}
	}
	return removed;
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
	const writeCmds = [
		"write",
		"echo",
		"cat >",
		"printf",
		"install",
		"cp",
		"mv",
		"rm",
		"mkdir",
		"touch",
	];
	for (const cmd of writeCmds) {
		if (command.startsWith(cmd) || command.includes(` ${cmd} `)) return true;
	}
	return DANGEROUS_BASH_PATTERNS.some((p) => p.test(command));
}

function ensureReviewGateignore(cwd: string): void {
	const gitignorePath = resolve(cwd, ".review-gate", ".gitignore");
	try {
		if (!existsSync(dirname(gitignorePath)))
			mkdirSync(dirname(gitignorePath), { recursive: true });
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
		const sandboxCommit = await git(["rev-parse", "HEAD"], sandboxPath).catch(
			() => "",
		);
		const diffText = sandboxCommit
			? await git(
					["diff", baseCommit, sandboxCommit, "--name-status", "-z"],
					sandboxPath,
				).catch(() =>
					git(["diff", baseCommit, "--name-status", "-z"], sandboxPath).catch(
						() => "",
					),
				)
			: await git(
					["diff", baseCommit, "--name-status", "-z"],
					sandboxPath,
				).catch(() => "");

		if (!diffText) {
			return null;
		}

		const batchId = `review-${new Date().toISOString().slice(0, 10)}-${baseCommit.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
		const files: FileReview[] = [];
		const fields = diffText.split("\0");

		for (let fieldIndex = 0; fieldIndex < fields.length - 1; ) {
			const status = fields[fieldIndex++]?.charAt(0);
			const hasTwoPaths = status === "R" || status === "C";
			const oldPath = hasTwoPaths ? fields[fieldIndex++] : undefined;
			const filePath = fields[fieldIndex++];
			if (!status || !"AMDR".includes(status)) continue;
			if (!filePath || (status === "R" && !oldPath)) continue;

			if (isExcluded(filePath)) continue;

			const resolvedPath = safeProjectPath(sandboxPath, filePath);
			const mainPath = safeProjectPath(cwd, oldPath ?? filePath);
			const destinationPath = safeProjectPath(cwd, filePath);
			const sandboxContent = existsSync(resolvedPath)
				? readFileSync(resolvedPath, "utf8")
				: "";
			const mainBeforeContent = existsSync(mainPath)
				? readFileSync(mainPath, "utf8")
				: "";

			const fileDiff = await git(
				["diff", baseCommit, sandboxCommit || "HEAD", "--", filePath],
				sandboxPath,
			).catch(() => "");

			const changedLoc = parseChangedLines(fileDiff);
			const hunks = parseHunks(fileDiff);
			const chunks = chunkHunks(hunks);

			const action =
				status === "A"
					? "create"
					: status === "D"
						? "delete"
						: status === "R"
							? "rename"
							: "modify";

			files.push({
				path: filePath,
				action,
				oldPath,
				baseFileHash: fileHash(mainBeforeContent),
				mainHashAtReviewStart:
					fileHashFromPath(mainPath) || fileHash(mainBeforeContent),
				mainExistsAtReviewStart: existsSync(mainPath),
				destinationHashAtReviewStart:
					status === "R"
						? (fileHashFromPath(destinationPath) ?? undefined)
						: undefined,
				destinationExistsAtReviewStart:
					status === "R" ? existsSync(destinationPath) : undefined,
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

		try {
			const mainSource = safeProjectPath(cwd, file.oldPath ?? file.path);
			const mainFile = safeProjectPath(cwd, file.path);
			const currentMainHash = fileHashFromPath(mainSource);
			const mainExists = currentMainHash !== null;
			const expectedMainExists =
				file.mainExistsAtReviewStart ?? file.action !== "create";
			if (
				mainExists !== expectedMainExists ||
				(mainExists && currentMainHash !== file.mainHashAtReviewStart)
			) {
				file.status = "stale";
				stale.push(file.path);
				continue;
			}

			if (file.action === "rename") {
				const destinationHash = fileHashFromPath(mainFile);
				const destinationExists = destinationHash !== null;
				const expectedDestinationExists =
					file.destinationExistsAtReviewStart ?? false;
				if (
					destinationExists !== expectedDestinationExists ||
					(destinationExists &&
						destinationHash !== file.destinationHashAtReviewStart)
				) {
					file.status = "stale";
					stale.push(file.path);
					continue;
				}
			}

			const sandboxFile = safeProjectPath(batch.sandboxPath, file.path);
			const sandboxExists = existsSync(sandboxFile);
			if (sandboxExists === (file.action === "delete")) {
				file.status = "stale";
				stale.push(file.path);
				continue;
			}
			const sandboxContent =
				file.action === "delete" ? "" : readFileSync(sandboxFile, "utf8");
			if (fileHash(sandboxContent) !== file.sandboxHash) {
				file.status = "stale";
				stale.push(file.path);
				continue;
			}

			if (file.action === "delete") {
				rmSync(mainSource, { force: true });
			} else {
				mkdirSync(dirname(mainFile), { recursive: true });
				writeFileSync(mainFile, sandboxContent);
				if (file.action === "rename" && mainSource !== mainFile) {
					rmSync(mainSource, { force: true });
				}
			}
			applied.push(file.path);
		} catch (err: any) {
			file.status = "conflicted";
			failed.push(file.path);
		}
	}

	batch.overallStatus =
		stale.length > 0 ? "partial" : applied.length > 0 ? "applied" : "cancelled";
	saveBatch(batch, cwd);

	if (ctx) {
		ctx.ui.notify(
			`Applied ${applied.length}, stale ${stale.length}, failed ${failed.length} files`,
			stale.length > 0 ? "warning" : "info",
		);
	}

	return { applied, failed, stale };
}

async function tryAutoApply(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	batch: ReviewBatch,
): Promise<boolean> {
	if (!AUTO_APPLY_ENABLED || IS_SUBAGENT_SESSION) return false;

	const policy = evaluateAutoReview(batch.files);
	if (!policy.eligible) {
		batch.autoReview = { decision: "blocked", reasons: policy.reasons };
		saveBatch(batch, ctx.cwd);
		return false;
	}

	batch.autoReview = { decision: "queued", reasons: [] };
	saveBatch(batch, ctx.cwd);
	const report = await runVerification(
		pi,
		ctx,
		batch.files.map((file) => file.path),
		"automatic",
		Date.now(),
		{ cwd: batch.sandboxPath, checkOnly: true },
	);
	const verified =
		report.status === "passed" &&
		report.commands.some((command) => command.status === "passed") &&
		!report.commands.some((command) => command.status === "failed");
	if (!verified) {
		batch.autoReview = {
			decision: "blocked",
			reasons: [
				`verification ${report.status}`,
				...report.skips,
			],
			verificationStatus: report.status,
		};
		saveBatch(batch, ctx.cwd);
		return false;
	}

	batch.autoReview = {
		decision: "eligible",
		reasons: [],
		verificationStatus: report.status,
	};
	for (const file of batch.files) file.status = "approved";
	const result = await applyApproved(batch, ctx.cwd, ctx);
	if (
		result.applied.length === batch.files.length &&
		result.failed.length === 0 &&
		result.stale.length === 0
	) {
		batch.autoReview.decision = "applied";
		saveBatch(batch, ctx.cwd);
		ctx.ui.notify(
			`Auto-applied reviewed batch: ${result.applied.length} files`,
			"info",
		);
		return true;
	}

	batch.autoReview = {
		decision: "blocked",
		reasons: ["apply encountered stale or conflicted files"],
		verificationStatus: report.status,
	};
	saveBatch(batch, ctx.cwd);
	return false;
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
	const reviewedChunks = file.chunks.filter(
		(c) => c.index <= chunkIndex,
	).length;

	// Header
	const batchLabel = `Batch: ${batch.batchId}  Agent: ${batch.generatedBy}`;
	lines.push(theme.fg("accent", theme.bold(batchLabel)));
	const actionSymbol =
		file.action === "create"
			? "➕"
			: file.action === "delete"
				? "➖"
				: file.action === "rename"
					? "📝"
					: "✏️";
	const locExemptLabel = file.locExempt
		? theme.fg("muted", "· LOC-exempt")
		: "";
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
	lines.push(
		theme.fg("dim", `  Base ${baseOk}  Main ${mainOk}  Sandbox ${sandboxOk}`),
	);
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
	const progressFilled = Math.round(
		(reviewedChunks / Math.max(totalChunks, 1)) * barLen,
	);
	const bar = "■".repeat(progressFilled) + "□".repeat(barLen - progressFilled);
	const approvedCount = batch.files.filter(
		(f) => f.status === "approved",
	).length;
	const rejectedCount = batch.files.filter(
		(f) => f.status === "rejected",
	).length;
	lines.push(
		`  Progress: [${bar}] chunks  File: ${file.status}  Files: ${approvedCount} approved · ${rejectedCount} rejected · ${batch.files.filter((f) => f.status === "pending").length} pending`,
	);
	lines.push("");

	// Keybindings
	lines.push(theme.fg("dim", KEYBINDINGS_HELP));

	return lines;
}

function currentHashMatches(file: FileReview, batch: ReviewBatch): boolean {
	const mainPath = resolve(
		batch.sandboxPath.replace(/\/sandbox.*/, ""),
		file.path,
	);
	const hash = fileHashFromPath(mainPath);
	return hash === file.mainHashAtReviewStart;
}

// ─── Native Neovim preview ─────────────────────────────────────────────────

interface NvimReviewDecision {
	type: "diff-decision";
	batchId: string;
	path: string;
	decision: "approved" | "rejected";
}

function nvimPreviewAction(file: FileReview): NvimPreviewAction {
	if (file.action === "create") return "add";
	if (file.action === "delete") return "delete";
	return "update";
}

async function openNvimReviewPreview(
	ctx: ExtensionContext,
	batch: ReviewBatch,
	file: FileReview,
): Promise<void> {
	const root = await resolveNvimProjectRoot(ctx.cwd);
	const mainPath = safeProjectPath(root, file.oldPath ?? file.path);
	const proposedPath = safeProjectPath(batch.sandboxPath, file.path);
	const [originalContent, proposedContent] = await Promise.all([
		existsSync(mainPath) ? readFile(mainPath, "utf8") : Promise.resolve(""),
		existsSync(proposedPath)
			? readFile(proposedPath, "utf8")
			: Promise.resolve(""),
	]);
	const result = await showNvimDiff({
		cwd: root,
		batchId: batch.batchId,
		filePath: file.path,
		absolutePath: safeProjectPath(root, file.path),
		action: nvimPreviewAction(file),
		originalContent,
		proposedContent,
	});
	ctx.ui.notify(
		result.ok
			? `Opened native Neovim diff: ${file.path}`
			: `Neovim preview unavailable: ${result.error ?? "unknown error"}`,
		result.ok ? "info" : "warning",
	);
}

async function readNewNvimDecisions(
	path: string,
	offset: number,
): Promise<{ nextOffset: number; decisions: NvimReviewDecision[] }> {
	try {
		const raw = await readFile(path);
		const start = raw.length < offset ? 0 : offset;
		if (raw.length <= start) return { nextOffset: raw.length, decisions: [] };
		const unread = raw.subarray(start);
		const finalNewline = unread.lastIndexOf(0x0a);
		if (finalNewline < 0) return { nextOffset: start, decisions: [] };
		const decisions = unread
			.subarray(0, finalNewline)
			.toString("utf8")
			.split("\n")
			.filter(Boolean)
			.flatMap((line) => {
				try {
					const packet = JSON.parse(line) as Partial<NvimReviewDecision>;
					return packet.type === "diff-decision" &&
						typeof packet.batchId === "string" &&
						typeof packet.path === "string" &&
						(packet.decision === "approved" || packet.decision === "rejected")
						? [packet as NvimReviewDecision]
						: [];
				} catch {
					return [];
				}
			});
		return { nextOffset: start + finalNewline + 1, decisions };
	} catch {
		return { nextOffset: offset, decisions: [] };
	}
}

// ─── Extension entry point ──────────────────────────────────────────────────

export default function (pi: ExtensionAPI): void {
	let decisionTimer: NodeJS.Timeout | undefined;
	let decisionOffset = 0;
	let decisionBusy = false;
	let decisionGeneration = 0;

	const startDecisionBridge = async (ctx: ExtensionContext) => {
		const generation = ++decisionGeneration;
		if (decisionTimer) clearInterval(decisionTimer);
		decisionBusy = false;
		const root = await resolveNvimProjectRoot(ctx.cwd);
		if (generation !== decisionGeneration) return;
		const path = join(root, ".pi", "nvim-decisions.jsonl");
		if (currentBatch) {
			decisionOffset = currentBatch.nvimDecisionOffset ?? 0;
		} else {
			try {
				decisionOffset = (await readFile(path)).length;
			} catch {
				decisionOffset = 0;
			}
		}
		decisionTimer = setInterval(() => {
			if (generation !== decisionGeneration || decisionBusy) return;
			decisionBusy = true;
			const readOffset = decisionOffset;
			void readNewNvimDecisions(path, readOffset)
				.then(async ({ nextOffset, decisions }) => {
					if (generation !== decisionGeneration) return;
					decisionOffset = nextOffset;
					const batch = currentBatch;
					if (!batch || (nextOffset === readOffset && decisions.length === 0))
						return;
					batch.nvimDecisionOffset = nextOffset;
					const latest = new Map<string, NvimReviewDecision>();
					for (const decision of decisions) {
						if (decision.batchId === batch.batchId) {
							latest.set(decision.path, decision);
						}
					}
					for (const decision of latest.values()) {
						const file = batch.files.find(
							(entry) => entry.path === decision.path,
						);
						if (!file || file.status !== "pending") continue;
						if (
							decision.decision === "approved" &&
							file.changedLoc > 80 &&
							!file.oversizedAck
						) {
							ctx.ui.notify(
								`Neovim approval blocked for large file (${file.changedLoc} LOC): acknowledge it in /review first`,
								"warning",
							);
							continue;
						}
						file.status = decision.decision;
						await closeNvimDiff(root, safeProjectPath(root, file.path));
						ctx.ui.notify(
							`Neovim ${decision.decision}: ${file.path}`,
							decision.decision === "approved" ? "info" : "warning",
						);
					}
					saveBatch(batch, ctx.cwd);
				})
				.catch((error) => {
					ctx.ui.notify(
						`Neovim decision bridge error: ${String(error)}`,
						"warning",
					);
				})
				.finally(() => {
					if (generation === decisionGeneration) decisionBusy = false;
				});
		}, 750);
	};

	const showGateStatus = (ctx: ExtensionContext, message?: string) => {
		if (!ctx.hasUI) return;
		const suspended = reviewSuspension.isActive();
		const enabled = reviewState.enabled;
		ctx.ui.setStatus(
			"review-gate",
			ctx.ui.theme.fg(
				suspended || !enabled ? "warning" : "accent",
				message || (suspended ? "gate suspended (clear-context)" : `gate ${enabled ? "enabled" : "disabled"}`),
			),
		);
	};

	pi.events.on(REVIEW_GATE_SUSPEND_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateSuspendPayload, ReviewGateSuspendResult>;
		request.tryHandle(() => {
			const { ctx, reason, ttlMs, publicationDeadlineMs } = request.payload;
			if (IS_SUBAGENT_SESSION || !ctx.hasUI || ctx.mode !== "tui") {
				return suspendFailure("Review-gate suspension requires the direct interactive TUI");
			}
			if (reason !== "clear-context-checkpoint") return suspendFailure("Unsupported review-gate suspension reason");
			if (decisionBusy || reviewMutationActive) return suspendFailure("Review state is currently mutating");
			reviewMutationActive = true;
			try {
				const version = batchMutationVersion;
				const reconciled = reconcilePendingBatches(ctx.cwd);
				if (!reconciled.ok) return suspendFailure(reconciled.error);
				if (reconciled.unresolved.length > 0) {
					return suspendFailure(`Resolve ${reconciled.unresolved.length} review batch(es) before clearing context`);
				}
				if (version !== batchMutationVersion) return suspendFailure("Review state changed during reconciliation");
				const result = reviewSuspension.suspend(reviewState.enabled, ttlMs, publicationDeadlineMs);
				if (!result.ok) return result;
				reviewState.enabled = false;
				decisionGeneration += 1;
				if (decisionTimer) clearInterval(decisionTimer);
				decisionTimer = undefined;
				return result;
			} finally {
				reviewMutationActive = false;
			}
		});
		if (request.result?.ok) showGateStatus(request.payload.ctx, "gate suspended (clear-context)");
	});

	pi.events.on(REVIEW_GATE_BEGIN_PUBLICATION_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateTokenPayload, ReviewGatePublicationResult>;
		request.tryHandle(() => reviewSuspension.beginPublication(request.payload.token));
	});

	pi.events.on(REVIEW_GATE_END_PUBLICATION_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateEndPublicationPayload, ReviewGateControlResult>;
		request.tryHandle(() => reviewSuspension.endPublication(request.payload.token, request.payload.success));
		if (!request.result?.ok) showGateStatus(request.payload.ctx);
	});

	pi.events.on(REVIEW_GATE_BEGIN_REPLACEMENT_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateTokenPayload, ReviewGateControlResult>;
		request.tryHandle(() => reviewSuspension.beginReplacement(request.payload.token));
	});

	pi.events.on(REVIEW_GATE_VALIDATE_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateTokenPayload, ReviewGateControlResult>;
		request.tryHandle(() => reviewSuspension.validate(request.payload.token));
	});

	pi.events.on(REVIEW_GATE_RESUME_EVENT, (raw) => {
		const request = raw as SyncControlRequest<ReviewGateResumePayload, ReviewGateControlResult>;
		request.tryHandle(() => reviewSuspension.restore(request.payload.token, request.payload.boundaryCrossed));
		if (request.result?.ok) showGateStatus(request.payload.ctx);
	});

	const toggleReviewGate = (ctx: ExtensionContext) => {
		if (reviewSuspension.isActive()) {
			ctx.ui.notify("Review gate is suspended for clear-context and cannot be toggled", "warning");
			return;
		}
		if (IS_SUBAGENT_SESSION) {
			reviewState.enabled = false;
			ctx.ui.setStatus(
				"review-gate",
				ctx.ui.theme.fg("muted", "gate off (subagent)"),
			);
			ctx.ui.notify(
				"Review gate is always disabled in subagent sessions",
				"info",
			);
			return;
		}
		if (!ctx.hasUI) {
			ctx.ui.notify(
				`Review gate: ${reviewState.enabled ? "enabled" : "disabled"} · ${currentBatch ? currentBatch.files.length + " files pending" : "no active batch"}`,
				"info",
			);
			return;
		}
		reviewState.enabled = !reviewState.enabled;
		const status = reviewState.enabled ? "enabled" : "disabled";
		ctx.ui.setStatus(
			"review-gate",
			ctx.ui.theme.fg(
				reviewState.enabled ? "accent" : "warning",
				`gate ${status}`,
			),
		);
		ctx.ui.notify(
			`Review gate ${status}`,
			reviewState.enabled ? "info" : "warning",
		);
	};
	pi.events.on("review-gate:toggle", (ctx) =>
		toggleReviewGate(ctx as ExtensionContext),
	);

	const reviewMutationBlocked = (ctx: ExtensionContext): boolean => {
		if (!reviewSuspension.isActive()) return false;
		ctx.ui.notify("Review actions are paused while clear-context saves its checkpoint", "warning");
		return true;
	};

	// ── Commands ──────────────────────────────────────────────────────────
	pi.registerCommand("review-gate", {
		description: "Toggle review gate or show status",
		handler: async (_args, ctx) => toggleReviewGate(ctx),
	});

	pi.registerCommand("review", {
		description: "Open the review overlay for current batch",
		handler: async (args, ctx) => {
			if (!ctx.hasUI || reviewMutationBlocked(ctx)) return;

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
			pi.appendEntry("review-gate-batch", { batchId: batch.batchId });
			await startDecisionBridge(ctx);
			openReviewOverlay(ctx, batch);
		},
	});

	pi.registerCommand("review-list", {
		description: "List all review batches with status summary",
		handler: async (_args, ctx) => {
			const batchIds = listBatches(ctx.cwd);
			if (batchIds.length === 0) {
				ctx.ui.notify("No review batches found", "info");
				return;
			}

			const summaries = batchIds
				.map((id) => {
					const b = loadBatch(ctx.cwd, id);
					if (!b) return null;
					const approved = b.files.filter(
						(f) => f.status === "approved",
					).length;
					const rejected = b.files.filter(
						(f) => f.status === "rejected",
					).length;
					const pending = b.files.filter((f) => f.status === "pending").length;
					return `${id.slice(-12)}  ${b.overallStatus}  ${b.files.length} files  ${approved}✓ ${rejected}✗ ${pending}○  ${b.generatedBy}`;
				})
				.filter(Boolean)
				.join("\n");

			ctx.ui.notify(`Review batches:\n${summaries}`, "info");
		},
	});

	pi.registerCommand("review-sandbox", {
		description:
			"Create a git worktree sandbox for review-gate codegen. Args: <branch-name>",
		handler: async (args, ctx) => {
			if (reviewMutationBlocked(ctx)) return;
			const branchName = (args || "").trim() || `review-${Date.now()}`;
			const sandboxPath = await createGitWorktree(ctx.cwd, branchName);
			if (!sandboxPath) {
				ctx.ui.notify("Failed to create sandbox worktree", "error");
				return;
			}
			ctx.ui.notify(
				`Sandbox created: ${sandboxPath} (branch: ${branchName})`,
				"info",
			);
		},
	});

	pi.registerCommand("review-batch", {
		description: "Create a review batch from a sandbox path",
		handler: async (args, ctx) => {
			if (reviewMutationBlocked(ctx)) return;
			// Parse args: sandbox path and generated-by label
			const parts = (args || "").trim().split(/\s+/);
			const sandboxPath = parts[0] || "";
			const generatedBy =
				parts.slice(1).join(" ") || pi.getActiveTools().join(",");

			if (!sandboxPath) {
				ctx.ui.notify(
					"Usage: /review-batch <sandbox-path> [generated-by]",
					"warning",
				);
				return;
			}

			const batch = await createBatchFromSandbox(
				ctx.cwd,
				sandboxPath,
				generatedBy,
			);
			if (!batch) {
				ctx.ui.notify("No changes found in sandbox", "warning");
				return;
			}

			const pruned = pruneSettledBatches(ctx.cwd);
			if (pruned > 0)
				ctx.ui.notify(`Pruned ${pruned} settled review batch(es)`, "info");

			pi.appendEntry("review-gate-batch", { batchId: batch.batchId });
			if (await tryAutoApply(pi, ctx, batch)) {
				currentBatch = null;
				ctx.ui.setStatus(
					"review-gate",
					ctx.ui.theme.fg("success", "✓ auto-applied"),
				);
				return;
			}

			currentBatch = batch;
			await startDecisionBridge(ctx);
			if (!reviewState.pendingBatches.includes(batch.batchId)) {
				reviewState.pendingBatches.push(batch.batchId);
			}

			saveBatch(batch, ctx.cwd);
			const reasons = batch.autoReview?.reasons;
			ctx.ui.notify(
				reasons?.length
					? `Manual review required: ${reasons.join("; ")}`
					: `Review batch created: ${batch.batchId} (${batch.files.length} files)`,
				"info",
			);
			ctx.ui.setStatus(
				"review-gate",
				ctx.ui.theme.fg("accent", `📋 ${batch.files.length} files pending`),
			);

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
		reviewSuspension.shutdown();
		reviewMutationActive = false;
		reviewState.enabled = !IS_SUBAGENT_SESSION;
		reviewState.pendingBatches = [];
		currentBatch = null;
		inGenerationPhase = false;
		if (IS_SUBAGENT_SESSION) {
			ctx.ui.setStatus(
				"review-gate",
				ctx.ui.theme.fg("muted", "gate off (subagent)"),
			);
			return;
		}

		// Ensure .review-gate/.gitignore exists
		ensureReviewGateignore(ctx.cwd);
		pruneSettledBatches(ctx.cwd);

		// Restore current batch from state if present
		const entries = ctx.sessionManager.getEntries();
		const reviewEntry = entries
			.filter((e: any) => e.customType === "review-gate-batch")
			.pop() as { data?: { batchId?: string } } | undefined;

		if (reviewEntry?.data?.batchId) {
			const batch = loadBatch(ctx.cwd, reviewEntry.data.batchId);
			if (batch) currentBatch = batch;
		}
		const reconciliation = reconcilePendingBatches(ctx.cwd);
		if (!reconciliation.ok) {
			ctx.ui.notify(`Review batch reconciliation failed: ${reconciliation.error}`, "warning");
		}
		await startDecisionBridge(ctx);

		if (currentBatch) {
			const pending = currentBatch.files.filter(
				(f) => f.status === "pending",
			).length;
			ctx.ui.setStatus(
				"review-gate",
				ctx.ui.theme.fg("accent", `📋 ${pending} pending`),
			);
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

	pi.on("session_shutdown", async () => {
		decisionGeneration++;
		if (decisionTimer) clearInterval(decisionTimer);
		decisionTimer = undefined;
		decisionBusy = false;
		reviewSuspension.shutdown();
		reviewMutationActive = false;
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
	const splitView = { enabled: false };
	let scrollOffset = 0;
	let horizontalOffset = 0;

	const closeNativePreview = (file: FileReview) => {
		void resolveNvimProjectRoot(ctx.cwd)
			.then((root) => closeNvimDiff(root, safeProjectPath(root, file.path)))
			.catch(() => undefined);
	};

	ctx.ui.custom<void>(
		(tui, theme, _kb, done) => {
			const overlay = {
				render(width: number): string[] {
					const file = batch.files[fileIndex];
					if (!file) return ["No files to review."];

					const lines: string[] = [];

					if (helpVisible) {
						lines.push(
							theme.fg("accent", theme.bold("Review Gate Keybindings")),
						);
						lines.push("");
						lines.push("Navigation:");
						lines.push("  j/k or ↑/↓  scroll diff down/up");
						lines.push("  h/l or ←/→  pan diff left/right");
						lines.push("  n/p or PgUp/PgDn  next/previous chunk");
						lines.push("  ]/[       next/previous file");
						lines.push("  g/G       first/last file");
						lines.push("  s         toggle side-by-side split diff");
						lines.push("  ?         toggle this help");
						lines.push("");
						lines.push("Review:");
						lines.push("  space     mark chunk as seen");
						lines.push("  a         approve current file");
						lines.push("  r         reject current file");
						lines.push("  d         defer current file");
						lines.push("  f         send feedback to agent");
						lines.push("  v         open native Neovim diff");
						lines.push("  w         acknowledge oversized hunk");
						lines.push("");
						lines.push("Batch:");
						lines.push("  x         apply all approved files");
						lines.push("  q/esc     close overlay");
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
						file.action === "create"
							? "➕"
							: file.action === "delete"
								? "➖"
								: file.action === "rename"
									? "📝"
									: "✏️";
					const locExemptLabel = file.locExempt
						? theme.fg("warning", " · LOC-exempt")
						: "";
					const statusColor =
						file.status === "approved"
							? "success"
							: file.status === "rejected"
								? "error"
								: file.status === "deferred"
									? "warning"
									: "text";
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
					lines.push(
						theme.fg("dim", `  ${"─".repeat(Math.min(width - 4, 60))}`),
					);

					// Diff content
					const chunk = file.chunks[chunkIndex];
					if (chunk) {
						const viewport = reviewViewportRows();
						const contentWidth = Math.max(12, width - 4);
						const diffLines = chunk.diffText.split("\n");
						let maxLineWidth = 0;
						for (const line of diffLines) {
							const raw = line.replace(/\x1b\[[0-9;]*m/g, "");
							if (raw.length > maxLineWidth) maxLineWidth = raw.length;
						}
						const maxHOffset = Math.max(0, maxLineWidth - contentWidth);
						horizontalOffset = Math.min(horizontalOffset, maxHOffset);

						function renderLine(raw: string): string {
							if (horizontalOffset <= 0)
								return padDiffPane(styleDiffLine(raw, theme), contentWidth);
							const plain = raw.replace(/\x1b\[[0-9;]*m/g, "");
							const sliced = plain.slice(
								horizontalOffset,
								horizontalOffset + contentWidth,
							);
							const styled = styleDiffLine(sliced, theme);
							return (
								styled + " ".repeat(Math.max(0, contentWidth - sliced.length))
							);
						}

						if (splitView.enabled) {
							const rows = splitDiffRows(chunk.diffText);
							const maxScroll = Math.max(0, rows.length - viewport);
							scrollOffset = Math.min(scrollOffset, maxScroll);
							const paneWidth = Math.max(1, Math.floor((width - 3) / 2));
							lines.push(
								theme.fg("error", padDiffPane(" BEFORE", paneWidth)) +
									theme.fg("dim", " │ ") +
									theme.fg("success", " AFTER"),
							);
							for (const row of rows.slice(
								scrollOffset,
								scrollOffset + viewport,
							)) {
								lines.push(
									padDiffPane(styleDiffLine(row.before, theme), paneWidth) +
										theme.fg("dim", " │ ") +
										padDiffPane(styleDiffLine(row.after, theme), paneWidth),
								);
							}
							if (rows.length > viewport) {
								lines.push(
									theme.fg(
										"muted",
										`  [${scrollOffset + Math.min(viewport, rows.length - scrollOffset)}/${rows.length} rows]`,
									),
								);
							}
						} else {
							const maxScroll = Math.max(0, diffLines.length - viewport);
							scrollOffset = Math.min(scrollOffset, maxScroll);
							const visibleLines = diffLines.slice(
								scrollOffset,
								scrollOffset + viewport,
							);
							for (const line of visibleLines) lines.push(renderLine(line));
							if (diffLines.length > viewport) {
								lines.push(
									theme.fg(
										"muted",
										`  V[${scrollOffset + visibleLines.length}/${diffLines.length}]`,
									),
								);
							}
						}
					} else {
						lines.push(theme.fg("muted", "  (no changes to display)"));
					}

					// Separator
					lines.push(
						theme.fg("dim", `  ${"─".repeat(Math.min(width - 4, 60))}`),
					);

					// Progress
					const approvedCount = batch.files.filter(
						(f) => f.status === "approved",
					).length;
					const rejectedCount = batch.files.filter(
						(f) => f.status === "rejected",
					).length;
					const pendingCount = batch.files.filter(
						(f) => f.status === "pending",
					).length;
					lines.push(
						`  ${theme.fg("success", `✓ ${approvedCount} approved`)}  ` +
							`${theme.fg("error", `✗ ${rejectedCount} rejected`)}  ` +
							`${theme.fg("muted", `○ ${pendingCount} pending`)}` +
							(file.status === "pending" && file.chunks.length > 0
								? `  Chunk: ${chunkIndex + 1}/${file.chunks.length}`
								: ""),
					);

					lines.push("");
					lines.push(
						theme.fg(
							"dim",
							`j/k scroll · h/l pan · n/p chunk · ]/[ file · s:${splitView.enabled ? "split" : "unified"} · v nvim · a/r/d approve`,
						),
					);
					lines.push(
						theme.fg("dim", "x apply approved · ? help · q/esc close"),
					);

					return lines;
				},

				wantsKeyRelease: false,

				handleInput(data: string): void {
					if (helpVisible) {
						helpVisible = false;
						tui.requestRender();
						return;
					}
					if (data === "q" || matchesKey(data, Key.escape)) {
						saveBatch(batch, ctx.cwd);
						done();
						return;
					}
					if (data === "v") {
						const file = batch.files[fileIndex];
						if (file) {
							void openNvimReviewPreview(ctx, batch, file).then(() =>
								tui.requestRender(),
							);
						}
						return;
					}
					if (data === "s") {
						splitView.enabled = !splitView.enabled;
						scrollOffset = 0;
						horizontalOffset = 0;
						ctx.ui.notify(
							`Diff view: ${splitView.enabled ? "split (BEFORE │ AFTER)" : "unified"}`,
							"info",
						);
						tui.requestRender();
						return;
					}

					const file = batch.files[fileIndex];
					if (!file) return;
					const chunk = file.chunks[chunkIndex];
					let rowCount = 0;
					if (chunk) {
						rowCount = splitView.enabled
							? splitDiffRows(chunk.diffText).length
							: chunk.diffText.split("\n").length;
					}
					const maxScroll = Math.max(0, rowCount - reviewViewportRows());

					if (data === "j" || matchesKey(data, Key.down)) {
						scrollOffset = Math.min(maxScroll, scrollOffset + 2);
						tui.requestRender();
					} else if (data === "k" || matchesKey(data, Key.up)) {
						scrollOffset = Math.max(0, scrollOffset - 2);
						tui.requestRender();
					} else if (data === "h" || matchesKey(data, Key.left)) {
						horizontalOffset = Math.max(0, horizontalOffset - 4);
						tui.requestRender();
					} else if (data === "l" || matchesKey(data, Key.right)) {
						horizontalOffset = Math.min(
							Number.MAX_SAFE_INTEGER,
							horizontalOffset + 4,
						);
						tui.requestRender();
						// Render clamps to actual maxHOffset on next frame
					} else if (data === "n" || matchesKey(data, Key.pageDown)) {
						if (chunkIndex < file.chunks.length - 1) {
							chunkIndex++;
							scrollOffset = 0;
							horizontalOffset = 0;
						}
						tui.requestRender();
					} else if (data === "p" || matchesKey(data, Key.pageUp)) {
						if (chunkIndex > 0) {
							chunkIndex--;
							scrollOffset = 0;
							horizontalOffset = 0;
						}
						tui.requestRender();
					} else if (data === "]" || data === "}") {
						if (fileIndex < batch.files.length - 1) {
							fileIndex++;
							chunkIndex = 0;
							scrollOffset = 0;
							horizontalOffset = 0;
						}
						tui.requestRender();
					} else if (data === "[" || data === "{") {
						if (fileIndex > 0) {
							fileIndex--;
							chunkIndex = 0;
							scrollOffset = 0;
							horizontalOffset = 0;
						}
						tui.requestRender();
					} else if (data === "g") {
						fileIndex = 0;
						chunkIndex = 0;
						scrollOffset = 0;
						horizontalOffset = 0;
						tui.requestRender();
					} else if (data === "G") {
						fileIndex = batch.files.length - 1;
						chunkIndex = 0;
						scrollOffset = 0;
						horizontalOffset = 0;
						tui.requestRender();
					} else if (data === " ") {
						// mark chunk seen - no explicit action needed, just acknowledge navigation
						tui.requestRender();
					} else if (data === "a") {
						// Approve file
						const isOversized = file.changedLoc > 80;
						if (isOversized && !file.oversizedAck) {
							ctx.ui.notify(
								`Large file (${file.changedLoc} LOC): press w to acknowledge before approval`,
								"warning",
							);
						} else {
							file.status = "approved";
							closeNativePreview(file);
							ctx.ui.notify(`Approved: ${file.path}`, "success");
						}
						tui.requestRender();
					} else if (data === "r") {
						file.status = "rejected";
						closeNativePreview(file);
						ctx.ui.notify(`Rejected: ${file.path}`, "error");
						tui.requestRender();
					} else if (data === "d") {
						file.status = "deferred";
						closeNativePreview(file);
						ctx.ui.notify(`Deferred: ${file.path}`, "warning");
						tui.requestRender();
					} else if (data === "w") {
						file.oversizedAck = true;
						ctx.ui.notify(
							`Oversized warning acknowledged: ${file.path}`,
							"info",
						);
						tui.requestRender();
					} else if (data === "f") {
						// Send feedback — async is tricky here, use notification + prompt
						ctx.ui
							.input("Feedback for agent (current file):", "")
							.then((feedback) => {
								if (feedback?.trim()) {
									file.rejectionReason = feedback.trim();
									ctx.ui.notify("Feedback recorded", "info");
									tui.requestRender();
								}
							});
					} else if (data === "x") {
						// Apply approved
						ctx.ui
							.confirm(
								"Apply approved files?",
								`Apply ${batch.files.filter((f) => f.status === "approved").length} file(s)?`,
							)
							.then(async (confirmed) => {
								if (confirmed) {
									const result = await applyApproved(batch, ctx.cwd, ctx);
									if (result.stale.length > 0) {
										ctx.ui.notify(
											`Stale files: ${result.stale.join(", ")}`,
											"warning",
										);
									}
									tui.requestRender();
								}
							});
					} else if (data === "?") {
						helpVisible = true;
						tui.requestRender();
					}
				},

				invalidate(): void {
					// No cache to clear
				},
			};

			return overlay;
		},
		{
			overlay: true,
			onHandle: (handle) => handle.focus(),
		},
	);
}

// ─── DiffView integration ───────────────────────────────────────────────────

function tryCreateDiffViewArtifact(
	batch: ReviewBatch,
	ctx: ExtensionContext,
): void {
	try {
		const diffviewerDir = resolve(ctx.cwd, ".diffviewer");
		if (!existsSync(diffviewerDir)) return;

		const artifactDir = join(diffviewerDir, "review-batches", batch.batchId);
		mkdirSync(artifactDir, { recursive: true });

		const summary = {
			type: "review-batch",
			batchId: batch.batchId,
			agent: batch.generatedBy,
			baseCommit: batch.baseCommit,
			files: batch.files.map((file) => ({
				path: file.path,
				action: file.action,
				changedLoc: file.changedLoc,
				status: file.status,
			})),
			ledger: `.review-gate/batches/${batch.batchId}/batch.json`,
			createdAt: Date.now(),
		};
		writeFileSync(
			join(artifactDir, "artifact.json"),
			JSON.stringify(summary, null, 2),
		);
		batch.diffviewerArtifactId = batch.batchId;
	} catch {
		// DiffView is optional.
	}
}

// ─── Sandbox helper ──────────────────────────────────────────────────────

async function createGitWorktree(
	cwd: string,
	branchName: string,
): Promise<string | null> {
	try {
		const worktreeDir = resolve(
			cwd,
			"..",
			`.review-gate-sandbox-${branchName}`,
		);
		await git(["worktree", "add", worktreeDir, "HEAD"], cwd);
		await git(["checkout", "-b", branchName], worktreeDir);
		return worktreeDir;
	} catch (err: any) {
		console.error("Failed to create worktree:", err.message);
		return null;
	}
}

async function removeGitWorktree(
	cwd: string,
	worktreePath: string,
): Promise<boolean> {
	try {
		await git(["worktree", "remove", "--force", worktreePath], cwd);
		return true;
	} catch {
		return false;
	}
}
