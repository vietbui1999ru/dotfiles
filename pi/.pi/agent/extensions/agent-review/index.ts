import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { copyFile, existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{40}$/;
const DIR = ".pi/agent-review";
function fallbackMs(): number {
	const raw = process.env.AGENT_REVIEW_FALLBACK_MS;
	if (!raw) return 30_000;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) return 30_000;
	return parsed;
}

type Mode = "on" | "off";
type Pending = {
	runId: string;
	base: string;
	baseTree: string;
	end: string;
	endTree: string;
	files: Array<{ file: string }>;
	startedAt: string;
	endedAt: string;
	modeMtimeMs: number;
	tamper?: true;
	error?: string;
};
type Decision = {
	runId: string;
	endTree: string;
	finalTree: string;
	files: Array<{ file: string; status: "accepted" | "changed" }>;
	notes: Array<{ file: string; line: number; note: string }>;
	patch: string;
	skipped?: true;
};
type Active = {
	runId: string;
	root: string;
	base: string;
	baseTree: string;
	startedAt: string;
	modeMtimeMs: number;
};

export const validRunId = (value: unknown): value is string =>
	typeof value === "string" && RUN_ID.test(value);
export const validHash = (value: unknown): value is string =>
	typeof value === "string" && HASH.test(value);
export const modeTampered = (before: number, after: number) => before !== after;
export const needsFollowUp = (decision: Decision) =>
	Boolean(
		decision.patch.trim() ||
			decision.notes.length ||
			decision.skipped ||
			decision.files.some((file) => file.status === "changed"),
	);
export const validDecisionShape = (value: unknown): value is Decision => {
	const decision = value as Partial<Decision>;
	if (!decision) return false;
	if (!validRunId(decision.runId)) return false;
	if (!validHash(decision.endTree) || !validHash(decision.finalTree)) return false;
	if (!Array.isArray(decision.files)) return false;
	for (const file of decision.files) {
		if (typeof file?.file !== "string") return false;
		if (file.status !== "accepted" && file.status !== "changed") return false;
	}
	if (!Array.isArray(decision.notes)) return false;
	for (const note of decision.notes) {
		if (typeof note?.file !== "string") return false;
		if (!Number.isInteger(note?.line)) return false;
		if (typeof note?.note !== "string") return false;
	}
	if (typeof decision.patch !== "string") return false;
	if (decision.skipped !== undefined && decision.skipped !== true) return false;
	return true;
};
export const validDecision = (
	pending: Pending,
	decision: Decision,
	finalTree: string,
) =>
	decision.runId === pending.runId &&
	decision.endTree === pending.endTree &&
	decision.finalTree === finalTree;

async function command(cwd: string, args: string[], env?: NodeJS.ProcessEnv) {
	return execFileAsync("git", args, { cwd, env, timeout: 15_000 });
}

export async function repoRoot(cwd: string) {
	return (await command(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim();
}

function path(root: string, ...parts: string[]) {
	return join(root, DIR, ...parts);
}

async function readJson<T>(file: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(file, "utf8")) as T;
	} catch {
		return undefined;
	}
}

async function atomic(file: string, value: unknown) {
	await mkdir(resolve(file, ".."), { recursive: true });
	const temp = `${file}.${randomUUID()}.tmp`;
	await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
	await rename(temp, file);
}

export async function snapshot(root: string, label: string) {
	const indexPath = (await command(root, ["rev-parse", "--git-path", "index"])).stdout.trim();
	const realIndex = resolve(root, indexPath);
	const tempIndex = join(tmpdir(), `agent-review-${randomUUID()}.index`);
	if (existsSync(realIndex)) {
		await new Promise<void>((ok, bad) =>
			copyFile(realIndex, tempIndex, (error) => (error ? bad(error) : ok())),
		);
	}
	const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
	try {
		await command(root, ["add", "-A", "--", ".", ":(exclude).pi/agent-review"], env);
		const tree = (await command(root, ["write-tree"], env)).stdout.trim();
		const commit = (await command(root, ["commit-tree", tree, "-m", label], env)).stdout.trim();
		return { commit, tree };
	} finally {
		await rm(tempIndex, { force: true });
	}
}

async function readMode(root: string) {
	const file = path(root, "mode.json");
	const record = await readJson<{ mode?: Mode }>(file);
	const info = await stat(file).catch(() => undefined);
	const selected: Mode = record?.mode === "off" ? "off" : "on";
	return { mode: selected, mtimeMs: info?.mtimeMs ?? 0 };
}

async function forceModeOn(root: string) {
	await atomic(path(root, "mode.json"), {
		mode: "on",
		setBy: "human",
		at: new Date().toISOString(),
	});
}

async function setRef(root: string, id: string, base?: string, end?: string) {
	if (base) await command(root, ["update-ref", `refs/agent-review/${id}/base`, base]);
	if (end) await command(root, ["update-ref", `refs/agent-review/${id}/end`, end]);
}

async function deleteRefs(root: string, id: string) {
	await command(root, ["update-ref", "-d", `refs/agent-review/${id}/base`]).catch(() => undefined);
	await command(root, ["update-ref", "-d", `refs/agent-review/${id}/end`]).catch(() => undefined);
}

async function listPending(root: string): Promise<Pending[]> {
	const dir = path(root, "pending");
	const names = await readdir(dir).catch(() => [] as string[]);
	const records: Pending[] = [];
	for (const name of names) {
		if (!name.endsWith(".json")) continue;
		const id = name.slice(0, -5);
		if (!validRunId(id)) continue;
		const record = await readJson<Pending>(join(dir, name));
		if (!record || record.runId !== id) continue;
		if (record.error) {
			records.push(record);
			continue;
		}
		if (validHash(record.baseTree) && validHash(record.endTree)) records.push(record);
	}
	return records;
}

const FOLLOW_UP_TEXT = (id: string) =>
	`Review of run ${id} is complete. Decisions, notes and the reviewer's patch: ` +
	`.pi/agent-review/decisions/${id}.json. Re-read the listed files before further changes. ` +
	`Do not reintroduce rejected changes.`;

export default function agentReview(pi: ExtensionAPI) {
	let active: Active | undefined;
	let verifierDone = false;
	let latestCtx: ExtensionContext | undefined;
	let watcher: ReturnType<typeof watch> | undefined;
	let fallbackTimer: NodeJS.Timeout | undefined;
	let finishing = false;
	let reviewFollowUp = false;
	const inflight = new Set<string>();

	const armFallback = (ctx: ExtensionContext) => {
		if (fallbackTimer) clearTimeout(fallbackTimer);
		fallbackTimer = setTimeout(() => {
			verifierDone = true;
			void finish(ctx);
		}, fallbackMs());
	};

	const disarmFallback = () => {
		if (fallbackTimer) clearTimeout(fallbackTimer);
		fallbackTimer = undefined;
	};

	const finish = async (ctx: ExtensionContext) => {
		if (!active || !verifierDone || finishing) return;
		finishing = true;
		const run = active;
		try {
			const end = await snapshot(run.root, "agent-review-end");
			if (end.tree === run.baseTree) {
				await deleteRefs(run.root, run.runId);
				active = undefined;
				return;
			}
			const currentMode = await readMode(run.root);
			const diffArgs = ["diff", "--name-only", run.baseTree, end.tree];
			const files = (await command(run.root, diffArgs)).stdout
				.split("\n")
				.filter(Boolean)
				.map((file) => ({ file }));
			const record: Pending = {
				runId: run.runId,
				base: run.base,
				baseTree: run.baseTree,
				end: end.commit,
				endTree: end.tree,
				files,
				startedAt: run.startedAt,
				endedAt: new Date().toISOString(),
				modeMtimeMs: run.modeMtimeMs,
			};
			if (modeTampered(run.modeMtimeMs, currentMode.mtimeMs)) {
				record.tamper = true;
				await forceModeOn(run.root);
			}
			await setRef(run.root, run.runId, run.base, end.commit);
			await atomic(path(run.root, "pending", `${run.runId}.json`), record);
			active = undefined;
			ctx.ui.setStatus("agent-review", "review pending — :AgentReview in nvim");
		} catch (error) {
			const record: Pending = {
				runId: run.runId,
				base: run.base,
				baseTree: run.baseTree,
				end: run.base,
				endTree: run.baseTree,
				files: [],
				startedAt: run.startedAt,
				endedAt: new Date().toISOString(),
				modeMtimeMs: run.modeMtimeMs,
				error: String(error),
			};
			await atomic(path(run.root, "pending", `${run.runId}.json`), record);
			active = undefined;
			ctx.ui.notify("Agent review snapshot failed; review remains pending", "error");
		} finally {
			finishing = false;
		}
	};

	const claim = async (file: string, processing: string) => {
		await rename(file, processing);
	};

	const release = async (processing: string, file: string) => {
		await rename(processing, file).catch(() => undefined);
	};

	const processDecision = async (ctx: ExtensionContext, root: string, id: string) => {
		if (!validRunId(id) || inflight.has(id)) return;
		inflight.add(id);
		const file = path(root, "pending", `${id}.json`);
		const processing = path(root, "pending", `${id}.processing`);
		let claimed = false;
		try {
			await claim(file, processing);
			claimed = true;
			const record = await readJson<Pending>(processing);
			const rawDecision = await readJson<unknown>(path(root, "decisions", `${id}.json`));
			if (!record || !validDecisionShape(rawDecision)) {
				throw new Error("invalid review record");
			}
			const final = await snapshot(root, "agent-review-final-check");
			if (!validDecision(record, rawDecision, final.tree)) {
				throw new Error("stale or forged decision");
			}
			await rm(processing, { force: true });
			await deleteRefs(root, id);
			if (needsFollowUp(rawDecision)) {
				reviewFollowUp = true;
				pi.sendUserMessage(FOLLOW_UP_TEXT(id), { deliverAs: "followUp" });
			}
			ctx.ui.setStatus("agent-review", undefined);
		} catch (error) {
			if (claimed) await release(processing, file);
			ctx.ui.notify(`Agent review decision ignored: ${String(error)}`, "warning");
		} finally {
			inflight.delete(id);
		}
	};

	pi.on("input", async (event, ctx) => {
		const root = await repoRoot(ctx.cwd);
		const blocked = await listPending(root);
		if (blocked.length > 0) {
			ctx.ui.notify(
				`Review pending — /review skip ${blocked[0].runId} to continue`,
				"warning",
			);
			return { action: "handled" as const };
		}
		if (event.source === "extension" && !reviewFollowUp) {
			if (active) disarmFallback();
			return { action: "continue" as const };
		}
		reviewFollowUp = false;
		const selected = await readMode(root);
		if (selected.mode === "off" || active) return { action: "continue" as const };
		const id = randomUUID();
		try {
			const base = await snapshot(root, "agent-review-base");
			await setRef(root, id, base.commit);
			active = {
				runId: id,
				root,
				base: base.commit,
				baseTree: base.tree,
				startedAt: new Date().toISOString(),
				modeMtimeMs: selected.mtimeMs,
			};
			verifierDone = false;
			latestCtx = ctx;
			disarmFallback();
			return { action: "continue" as const };
		} catch (error) {
			const record: Pending = {
				runId: id,
				base: "",
				baseTree: "",
				end: "",
				endTree: "",
				files: [],
				startedAt: new Date().toISOString(),
				endedAt: new Date().toISOString(),
				modeMtimeMs: selected.mtimeMs,
				error: `start snapshot failed: ${String(error)}`,
			};
			await atomic(path(root, "pending", `${id}.json`), record);
			ctx.ui.notify("Agent review start snapshot failed; input blocked", "error");
			return { action: "handled" as const };
		}
	});

	pi.events.on("post-run-verifier:settled", () => {
		verifierDone = true;
		if (latestCtx) void finish(latestCtx);
	});

	pi.on("agent_start", () => {
		disarmFallback();
	});

	pi.on("agent_settled", async (_event, ctx) => {
		latestCtx = ctx;
		armFallback(ctx);
		await finish(ctx);
	});

	pi.registerCommand("review", {
		description: "List reviews or skip one",
		handler: async (args, ctx) => {
			const root = await repoRoot(ctx.cwd);
			const [verb, id] = args.trim().split(/\s+/, 2);
			const records = await listPending(root);
			if (verb === "skip" && validRunId(id)) {
				const record = records.find((entry) => entry.runId === id);
				if (!record) {
					ctx.ui.notify("Unknown review", "warning");
					return;
				}
				if (record.error) {
					await rm(path(root, "pending", `${id}.json`), { force: true });
					ctx.ui.notify(`Skipped error review ${id}: ${record.error}. If snapshots keep failing, run agent-review mode off.`, "warning");
					return;
				}
				const final = await snapshot(root, "agent-review-skip");
				const decision: Decision = {
					runId: id,
					endTree: record.endTree,
					finalTree: final.tree,
					files: [],
					notes: [],
					patch: "",
					skipped: true,
				};
				await atomic(path(root, "decisions", `${id}.json`), decision);
				return;
			}
			const ids = records.map((entry) => entry.runId).join(", ");
			ctx.ui.notify(records.length ? `Pending reviews: ${ids}` : "No pending reviews", "info");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		const root = await repoRoot(ctx.cwd);
		const decisionsDir = path(root, "decisions");
		await mkdir(decisionsDir, { recursive: true });
		const records = await listPending(root);
		if (records.length > 0) {
			ctx.ui.setStatus("agent-review", "review pending — :AgentReview in nvim");
		}
		// Process decisions that arrived while Pi was down.
		const names = await readdir(decisionsDir).catch(() => [] as string[]);
		for (const name of names) {
			if (!name.endsWith(".json")) continue;
			const id = basename(name, ".json");
			if (validRunId(id)) void processDecision(ctx, root, id);
		}
		watcher?.close();
		watcher = watch(decisionsDir, (_event, name) => {
			if (typeof name !== "string" || !name.endsWith(".json")) return;
			const id = basename(name, ".json");
			if (id) void processDecision(ctx, root, id);
		});
	});

	pi.on("session_shutdown", () => {
		watcher?.close();
		disarmFallback();
	});
}
