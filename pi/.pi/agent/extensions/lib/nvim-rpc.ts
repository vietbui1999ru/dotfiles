import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type NvimPreviewAction = "update" | "add" | "delete";

export interface NvimDiffPreview {
	cwd: string;
	batchId: string;
	filePath: string;
	absolutePath: string;
	action: NvimPreviewAction;
	originalContent: string;
	proposedContent: string;
}

export interface NvimRpcResult {
	ok: boolean;
	error?: string;
	socket?: string;
}

interface PendingPreview {
	batchId?: string;
	path?: string;
	absPath?: string;
}

let previewLifecycle: Promise<void> = Promise.resolve();

function enqueuePreviewLifecycle<T>(operation: () => Promise<T>): Promise<T> {
	const result = previewLifecycle.then(operation, operation);
	previewLifecycle = result.then(
		() => undefined,
		() => undefined,
	);
	return result;
}

async function readNonEmpty(path: string): Promise<string | undefined> {
	try {
		const value = (await readFile(path, "utf8")).trim();
		return value || undefined;
	} catch {
		return undefined;
	}
}

async function readPendingPreview(
	path: string,
): Promise<PendingPreview | undefined> {
	try {
		return JSON.parse(await readFile(path, "utf8")) as PendingPreview;
	} catch {
		return undefined;
	}
}

export async function resolveNvimProjectRoot(cwd: string): Promise<string> {
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "rev-parse", "--show-toplevel"],
			{ timeout: 3000 },
		);
		return resolve(stdout.trim());
	} catch {
		return resolve(cwd);
	}
}

export async function discoverNvimSocket(
	cwd: string,
): Promise<string | undefined> {
	const root = await resolveNvimProjectRoot(cwd);
	const socket = await readNonEmpty(join(root, ".pi", "nvim-servername"));
	return socket && existsSync(socket) ? socket : undefined;
}

async function nvimCall(
	cwd: string,
	moduleName: string,
	functionName: string,
	args: unknown[],
): Promise<NvimRpcResult> {
	const root = await resolveNvimProjectRoot(cwd);
	const socket = await discoverNvimSocket(root);
	if (!socket) return { ok: false, error: "No running Neovim socket found" };

	const callDir = await mkdtemp(join(tmpdir(), "pi-nvim-rpc-"));
	const argsPath = join(callDir, "args.json");
	try {
		await writeFile(argsPath, JSON.stringify(args), "utf8");
		const luaSource = `require('code-preview.rpc').dispatch('${moduleName}', '${functionName}', ${JSON.stringify(argsPath)})`;
		const expression = `luaeval(${JSON.stringify(luaSource)})`;
		await execFileAsync(
			"nvim",
			["--server", socket, "--remote-expr", expression],
			{ cwd: root, timeout: 5000 },
		);
		return { ok: true, socket };
	} catch (error) {
		return { ok: false, socket, error: String(error) };
	} finally {
		await rm(callDir, { recursive: true, force: true });
	}
}

async function showNvimDiffNow(
	preview: NvimDiffPreview,
): Promise<NvimRpcResult> {
	const root = await resolveNvimProjectRoot(preview.cwd);
	const piDir = join(root, ".pi");
	const pendingPath = join(piDir, "nvim-preview.json");
	const previous = await readPendingPreview(pendingPath);
	if (previous?.absPath) {
		await nvimCall(root, "code-preview.diff", "close_for_file", [
			resolve(previous.absPath),
		]);
	}

	const previewDir = await mkdtemp(join(tmpdir(), "pi-review-preview-"));
	const extension = basename(preview.filePath).replace(/^[^.]+/, "");
	const beforePath = join(previewDir, `CURRENT${extension}`);
	const afterPath = join(previewDir, `PROPOSED${extension}`);
	try {
		await Promise.all([
			writeFile(beforePath, preview.originalContent, "utf8"),
			writeFile(afterPath, preview.proposedContent, "utf8"),
		]);
		await mkdir(piDir, { recursive: true });
		await writeFile(
			pendingPath,
			JSON.stringify(
				{
					type: "diff-preview",
					batchId: preview.batchId,
					path: preview.filePath,
					absPath: resolve(preview.absolutePath),
					ts: new Date().toISOString(),
				},
				null,
				2,
			),
			"utf8",
		);
		const result = await nvimCall(root, "code-preview.diff", "show_diff", [
			beforePath,
			afterPath,
			preview.filePath,
			resolve(preview.absolutePath),
			preview.action,
			"pi",
		]);
		if (!result.ok) await rm(pendingPath, { force: true });
		return result;
	} finally {
		await rm(previewDir, { recursive: true, force: true });
	}
}

export function showNvimDiff(preview: NvimDiffPreview): Promise<NvimRpcResult> {
	return enqueuePreviewLifecycle(() => showNvimDiffNow(preview));
}

async function closeNvimDiffNow(
	cwd: string,
	absolutePath: string,
): Promise<NvimRpcResult> {
	const root = await resolveNvimProjectRoot(cwd);
	const resolvedPath = resolve(absolutePath);
	const result = await nvimCall(root, "code-preview.diff", "close_for_file", [
		resolvedPath,
	]);
	const pendingPath = join(root, ".pi", "nvim-preview.json");
	const pending = await readPendingPreview(pendingPath);
	if (pending?.absPath && resolve(pending.absPath) === resolvedPath) {
		await rm(pendingPath, { force: true });
	}
	return result;
}

export function closeNvimDiff(
	cwd: string,
	absolutePath: string,
): Promise<NvimRpcResult> {
	return enqueuePreviewLifecycle(() => closeNvimDiffNow(cwd, absolutePath));
}
