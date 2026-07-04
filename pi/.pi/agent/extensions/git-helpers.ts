import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { truncateToWidth } from "@earendil-works/pi-tui";

const execFileAsync = promisify(execFile);

// Pi auto-discovers every top-level *.ts file in ~/.pi/agent/extensions.
// This module is primarily shared helper code for sibling extensions, but it
// also needs to be a valid no-op extension when discovered directly.
export default function gitHelpersExtension(): void {
	// Intentionally empty.
}

export const C = {
	peach: "38;5;216",
	green: "38;5;150",
	yellow: "38;5;222",
	red: "38;5;210",
	lavender: "38;5;183",
	teal: "38;5;116",
	dim: "38;5;60",
};

export const RESET = "\x1b[0m";

export function color(text: string, code: string): string {
	return `\x1b[${code}m${text}${RESET}`;
}

export function dim(text: string): string {
	return color(text, C.dim);
}

// Column-align text that may already carry ANSI color codes (e.g. from
// color()/dim()). Plain .padEnd().slice() operates on raw character count,
// which includes invisible escape bytes — slicing at that boundary can land
// mid-escape-sequence and corrupt the terminal's render state. truncateToWidth
// measures visible width and pads/truncates around escape sequences safely.
export function padVisible(text: string, width: number): string {
	return truncateToWidth(text, width, "", true);
}

export interface WorkflowGitConfig {
	staleDays?: number;
	historyDepth?: number;
	repos?: string[];
	multiRepo?: boolean;
}

export interface WorktreeInfo {
	repoRoot: string;
	path: string;
	relPath: string;
	branch?: string;
	head?: string;
	lastCommitRelative?: string;
	lastCommitEpoch?: number;
	ageDays?: number;
	dirty: boolean;
	statusCount: number;
	untrackedCount: number;
	locked?: boolean;
	prunable?: boolean;
	detached?: boolean;
	ahead?: number;
	behind?: number;
	stale: boolean;
	active: boolean;
}

export interface BranchInfo {
	repoRoot: string;
	name: string;
	head: string;
	subject: string;
	author: string;
	lastCommitRelative: string;
	lastCommitEpoch: number;
	ageDays: number;
	ahead?: number;
	behind?: number;
	merged: boolean;
	worktreePath?: string;
	stale: boolean;
}

export interface GitSnapshot {
	repoRoot: string;
	defaultBranch: string;
	worktrees: WorktreeInfo[];
	branches: BranchInfo[];
}

export async function execGit(
	cwd: string,
	args: string[],
	timeout = 5000,
): Promise<string> {
	const { stdout } = await execFileAsync(
		"git",
		["-C", cwd, "--no-optional-locks", ...args],
		{ timeout, maxBuffer: 8 * 1024 * 1024 },
	);
	return stdout;
}

export async function execCmd(
	cmd: string,
	args: string[],
	cwd: string,
	timeout = 5000,
): Promise<{ stdout: string; stderr: string; code: number }> {
	try {
		const { stdout, stderr } = await execFileAsync(cmd, args, {
			cwd,
			timeout,
			maxBuffer: 8 * 1024 * 1024,
		});
		return { stdout, stderr, code: 0 };
	} catch (error: any) {
		return {
			stdout: error.stdout || "",
			stderr: error.stderr || String(error),
			code: typeof error.code === "number" ? error.code : 1,
		};
	}
}

export async function gitMainRoot(cwd: string): Promise<string> {
	let common = (await execGit(cwd, ["rev-parse", "--git-common-dir"], 2000)).trim();
	if (!common.startsWith("/")) common = resolve(cwd, common);
	return dirname(common);
}

export async function commandrBus(cwd: string): Promise<string | undefined> {
	try {
		const root = await gitMainRoot(cwd);
		const bus = join(root, ".agents");
		return existsSync(bus) ? bus : undefined;
	} catch {
		return undefined;
	}
}

export async function currentBranch(cwd: string): Promise<string | undefined> {
	try {
		const branch = (await execGit(cwd, ["branch", "--show-current"], 2000)).trim();
		return branch || undefined;
	} catch {
		return undefined;
	}
}

export async function currentHead(cwd: string): Promise<string | undefined> {
	try {
		return (await execGit(cwd, ["rev-parse", "--short", "HEAD"], 2000)).trim();
	} catch {
		return undefined;
	}
}

async function defaultBranch(cwd: string): Promise<string> {
	try {
		const ref = (await execGit(cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], 2000)).trim();
		const branch = ref.replace(/^origin\//, "");
		if (branch) return branch;
	} catch {
		/* ignore */
	}
	for (const candidate of ["main", "master"]) {
		try {
			await execGit(cwd, ["rev-parse", "--verify", candidate], 2000);
			return candidate;
		} catch {
			/* ignore */
		}
	}
	return (await currentBranch(cwd)) || "HEAD";
}

function parseWorktreePorcelain(stdout: string): Array<Record<string, string | boolean>> {
	const items: Array<Record<string, string | boolean>> = [];
	let item: Record<string, string | boolean> | undefined;
	for (const line of stdout.split("\n")) {
		if (!line.trim()) continue;
		const [key, ...rest] = line.split(" ");
		const value = rest.join(" ");
		if (key === "worktree") {
			if (item) items.push(item);
			item = { worktree: value };
		} else if (item) {
			item[key] = value || true;
		}
	}
	if (item) items.push(item);
	return items;
}

async function statusCounts(path: string): Promise<{ dirty: boolean; statusCount: number; untrackedCount: number }> {
	try {
		const out = await execGit(path, ["status", "--porcelain=v1"], 3000);
		const lines = out.split("\n").filter(Boolean);
		return {
			dirty: lines.length > 0,
			statusCount: lines.length,
			untrackedCount: lines.filter((line) => line.startsWith("??")).length,
		};
	} catch {
		return { dirty: false, statusCount: 0, untrackedCount: 0 };
	}
}

async function aheadBehind(cwd: string, left: string, right = "HEAD"): Promise<{ ahead?: number; behind?: number }> {
	try {
		const out = (await execGit(cwd, ["rev-list", "--left-right", "--count", `${left}...${right}`], 3000)).trim();
		const [behind, ahead] = out.split(/\s+/).map(Number);
		return { ahead: Number.isFinite(ahead) ? ahead : undefined, behind: Number.isFinite(behind) ? behind : undefined };
	} catch {
		return {};
	}
}

async function logMeta(cwd: string, ref = "HEAD"): Promise<{ head?: string; relative?: string; epoch?: number; subject?: string; author?: string }> {
	try {
		const out = (await execGit(cwd, ["log", "-1", "--format=%h%x1f%cr%x1f%ct%x1f%s%x1f%an", ref], 3000)).trim();
		const [head, relative, epochRaw, subject, author] = out.split("\x1f");
		return { head, relative, epoch: Number(epochRaw), subject, author };
	} catch {
		return {};
	}
}

function ageDays(epoch?: number): number | undefined {
	if (!epoch) return undefined;
	return Math.floor((Date.now() / 1000 - epoch) / 86400);
}

function branchName(ref: unknown): string | undefined {
	if (typeof ref !== "string") return undefined;
	return ref.replace(/^refs\/heads\//, "") || undefined;
}

export async function listWorktrees(cwd: string, staleDays = 14): Promise<WorktreeInfo[]> {
	const repoRoot = await gitMainRoot(cwd);
	const def = await defaultBranch(cwd);
	const raw = await execGit(cwd, ["worktree", "list", "--porcelain"], 5000);
	const items = parseWorktreePorcelain(raw);
	return Promise.all(
		items.map(async (item) => {
			const path = String(item.worktree || "");
			const meta = await logMeta(path);
			const age = ageDays(meta.epoch) ?? 9999;
			const counts = await statusCounts(path);
			const ab = await aheadBehind(path, def);
			return {
				repoRoot,
				path,
				relPath: relative(repoRoot, path) || ".",
				branch: branchName(item.branch),
				head: String(item.HEAD || meta.head || "").slice(0, 12),
				lastCommitRelative: meta.relative,
				lastCommitEpoch: meta.epoch,
				ageDays: age,
				dirty: counts.dirty,
				statusCount: counts.statusCount,
				untrackedCount: counts.untrackedCount,
				locked: Boolean(item.locked),
				prunable: Boolean(item.prunable),
				detached: Boolean(item.detached) || !item.branch,
				ahead: ab.ahead,
				behind: ab.behind,
				stale: age > staleDays,
				active: resolve(path) === resolve(cwd) || age <= 3,
			};
		}),
	);
}

async function mergedBranches(cwd: string, def: string): Promise<Set<string>> {
	try {
		const out = await execGit(cwd, ["branch", "--merged", def], 3000);
		return new Set(out.split("\n").map((line) => line.replace(/^\*?\s*/, "").trim()).filter(Boolean));
	} catch {
		return new Set();
	}
}

export async function listBranches(cwd: string, staleDays = 14): Promise<BranchInfo[]> {
	const repoRoot = await gitMainRoot(cwd);
	const def = await defaultBranch(cwd);
	const worktrees = await listWorktrees(cwd, staleDays);
	const byBranch = new Map(worktrees.flatMap((wt) => (wt.branch ? [[wt.branch, wt.path] as const] : [])));
	const merged = await mergedBranches(cwd, def);
	const fmt = "%(refname:short)%x1f%(objectname:short)%x1f%(committerdate:relative)%x1f%(committerdate:unix)%x1f%(subject)%x1f%(authorname)";
	const raw = await execGit(cwd, ["for-each-ref", "refs/heads", `--format=${fmt}`], 5000);
	return Promise.all(
		raw.split("\n").filter(Boolean).map(async (line) => {
			const [name, head, relDate, epochRaw, subject, author] = line.split("\x1f");
			const epoch = Number(epochRaw);
			const age = ageDays(epoch) ?? 9999;
			let ab = await aheadBehind(cwd, `${name}@{upstream}`, name);
			if (ab.ahead === undefined && ab.behind === undefined) ab = await aheadBehind(cwd, def, name);
			return {
				repoRoot,
				name,
				head,
				subject,
				author,
				lastCommitRelative: relDate,
				lastCommitEpoch: epoch,
				ageDays: age,
				ahead: ab.ahead,
				behind: ab.behind,
				merged: merged.has(name),
				worktreePath: byBranch.get(name),
				stale: age > staleDays,
			};
		}),
	);
}

export async function gitHistory(cwd: string, ref = "HEAD", depth = 20): Promise<string[]> {
	try {
		const out = await execGit(cwd, ["log", `-${depth}`, "--oneline", "--graph", "--decorate", "--date=short", ref], 5000);
		return out.split("\n").filter(Boolean);
	} catch (error: any) {
		return [`history unavailable: ${String(error?.message || error)}`];
	}
}

export async function gitSnapshot(cwd: string, cfg: WorkflowGitConfig = {}): Promise<GitSnapshot> {
	const staleDays = cfg.staleDays ?? 14;
	const repoRoot = await gitMainRoot(cwd);
	const [worktrees, branches, def] = await Promise.all([
		listWorktrees(cwd, staleDays),
		listBranches(cwd, staleDays),
		defaultBranch(cwd),
	]);
	return { repoRoot, defaultBranch: def, worktrees, branches };
}

export function expandHome(path: string, home: string): string {
	return path === "~" || path.startsWith("~/") ? join(home, path.slice(2)) : path;
}

export async function backupWorktree(worktreePath: string, sourceSession?: string): Promise<string> {
	const bus = await commandrBus(worktreePath);
	const root = bus || join(await gitMainRoot(worktreePath), ".agents");
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const dir = join(root, "worktree-backups", stamp);
	await mkdir(dir, { recursive: true });
	const [status, diff, staged, head, branch] = await Promise.all([
		execCmd("git", ["-C", worktreePath, "status", "--porcelain=v1"], worktreePath, 5000),
		execCmd("git", ["-C", worktreePath, "diff"], worktreePath, 10000),
		execCmd("git", ["-C", worktreePath, "diff", "--cached"], worktreePath, 10000),
		currentHead(worktreePath),
		currentBranch(worktreePath),
	]);
	await writeFile(join(dir, "status.txt"), status.stdout || "(clean)\n");
	await writeFile(join(dir, "diff.patch"), diff.stdout || "");
	await writeFile(join(dir, "staged.patch"), staged.stdout || "");
	const untracked = status.stdout.split("\n").filter((line) => line.startsWith("?? ")).map((line) => line.slice(3));
	await writeFile(join(dir, "untracked.txt"), untracked.join("\n") + (untracked.length ? "\n" : ""));
	if (untracked.length) {
		await writeFile(join(dir, "untracked-files.txt"), untracked.join("\n") + "\n");
		await execCmd("tar", ["-czf", join(dir, "untracked.tgz"), "-T", join(dir, "untracked-files.txt")], worktreePath, 15000);
	}
	await writeFile(
		join(dir, "metadata.json"),
		JSON.stringify(
			{
				created_at: new Date().toISOString(),
				worktreePath,
				branch,
				head,
				sourceSession,
				statusCount: status.stdout.split("\n").filter(Boolean).length,
				untrackedCount: untracked.length,
			},
			null,
			2,
		) + "\n",
	);
	return dir;
}

export async function writeWorktreeHandoff(params: {
	cwd: string;
	targetWorktree: string;
	action: string;
	sourceSession?: string;
}): Promise<string> {
	const bus = await commandrBus(params.cwd);
	const root = bus || join(await gitMainRoot(params.cwd), ".agents");
	const dir = join(root, "worktree-sessions");
	await mkdir(dir, { recursive: true });
	const stamp = new Date().toISOString().replace(/[:.]/g, "-");
	const branch = await currentBranch(params.targetWorktree);
	const head = await currentHead(params.targetWorktree);
	const status = await execCmd("git", ["-C", params.targetWorktree, "status", "--porcelain=v1"], params.targetWorktree, 5000);
	const marker = join(dir, `${stamp}-${(branch || "detached").replace(/[^a-zA-Z0-9._-]+/g, "-")}.json`);
	await writeFile(
		marker,
		JSON.stringify(
			{
				ts: new Date().toISOString(),
				sourceCwd: params.cwd,
				sourceSession: params.sourceSession,
				targetWorktree: params.targetWorktree,
				branch,
				head,
				action: params.action,
				dirtySummary: status.stdout.split("\n").filter(Boolean).slice(0, 50),
			},
			null,
			2,
		) + "\n",
	);
	return marker;
}

export async function readJsonObject(path: string): Promise<Record<string, unknown>> {
	try {
		const raw = await readFile(path, "utf8");
		const parsed = JSON.parse(raw);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}
