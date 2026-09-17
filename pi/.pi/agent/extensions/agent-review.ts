import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { copyFile, existsSync, watch } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{40}$/;
const DIR = ".pi/agent-review";

type Mode = "on" | "off";
type Pending = { runId: string; base: string; baseTree: string; end: string; endTree: string; files: Array<{ file: string }>; startedAt: string; endedAt: string; modeMtimeMs: number; tamper?: true; error?: string };
type Decision = { runId: string; endTree: string; finalTree: string; files: Array<{ file: string; status: "accepted" | "changed" }>; notes: Array<{ file: string; line: number; note: string }>; patch: string; skipped?: true };
type Active = { runId: string; root: string; base: string; baseTree: string; startedAt: string; modeMtimeMs: number; queuedMode?: Mode };

export const validRunId = (value: unknown): value is string => typeof value === "string" && RUN_ID.test(value);
export const validHash = (value: unknown): value is string => typeof value === "string" && HASH.test(value);
export const modeTampered = (before: number, after: number) => before !== after;
export const validDecision = (pending: Pending, decision: Decision, finalTree: string) => validRunId(decision.runId) && decision.runId === pending.runId && validHash(decision.endTree) && validHash(decision.finalTree) && decision.endTree === pending.endTree && decision.finalTree === finalTree;
export const needsFollowUp = (decision: Decision) => Boolean(decision.patch.trim() || decision.notes.length || decision.skipped || decision.files.some((f) => f.status === "changed"));

async function command(cwd: string, args: string[], env?: NodeJS.ProcessEnv) { return execFileAsync("git", args, { cwd, env, timeout: 15_000 }); }
export async function repoRoot(cwd: string) { return (await command(cwd, ["rev-parse", "--show-toplevel"])).stdout.trim(); }
function path(root: string, ...parts: string[]) { return join(root, DIR, ...parts); }
async function json<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; } }
async function atomic(file: string, value: unknown) { await mkdir(resolve(file, ".."), { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`); await rename(temp, file); }

export async function snapshot(root: string, label: string) {
  const indexPath = (await command(root, ["rev-parse", "--git-path", "index"])).stdout.trim();
  const realIndex = resolve(root, indexPath);
  const tempIndex = join(tmpdir(), `agent-review-${randomUUID()}.index`);
  if (existsSync(realIndex)) await new Promise<void>((ok, bad) => copyFile(realIndex, tempIndex, (e) => e ? bad(e) : ok()));
  const env = { ...process.env, GIT_INDEX_FILE: tempIndex };
  try {
    await command(root, ["add", "-A", "--", ".", ":(exclude).pi/agent-review"], env);
    const tree = (await command(root, ["write-tree"], env)).stdout.trim();
    const commit = (await command(root, ["commit-tree", tree, "-m", label], env)).stdout.trim();
    return { commit, tree };
  } finally { await rm(tempIndex, { force: true }); }
}

async function mode(root: string) { const file = path(root, "mode.json"); const record = await json<{mode?: Mode}>(file); const time = await stat(file).then((s) => s.mtimeMs).catch(() => 0); return { mode: record?.mode === "off" ? "off" : "on" as Mode, mtime: time }; }
async function forceOn(root: string) { await atomic(path(root, "mode.json"), { mode: "on", setBy: "human", at: new Date().toISOString() }); }
async function refs(root: string, id: string, base?: string, end?: string) { if (base) await command(root, ["update-ref", `refs/agent-review/${id}/base`, base]); if (end) await command(root, ["update-ref", `refs/agent-review/${id}/end`, end]); }
async function deleteRefs(root: string, id: string) { await command(root, ["update-ref", "-d", `refs/agent-review/${id}/base`]).catch(() => undefined); await command(root, ["update-ref", "-d", `refs/agent-review/${id}/end`]).catch(() => undefined); }
async function pending(root: string) { const dir = path(root, "pending"); const names = await readdir(dir).catch(() => []); const records: Pending[] = []; for (const name of names) { if (!name.endsWith(".json")) continue; const id = name.slice(0, -5); if (!validRunId(id)) continue; const record = await json<Pending>(join(dir, name)); if (record?.runId === id && validHash(record.baseTree) && validHash(record.endTree)) records.push(record); } return records; }

export default function agentReview(pi: ExtensionAPI) {
  let active: Active | undefined; let verifierDone = false; let latestCtx: ExtensionContext | undefined; let watcher: ReturnType<typeof watch> | undefined; let timer: NodeJS.Timeout | undefined; const inflight = new Set<string>();
  const finish = async (ctx: ExtensionContext) => {
    if (!active || !verifierDone) return; const run = active;
    try {
      const end = await snapshot(run.root, "agent-review-end");
      if (end.tree === run.baseTree) { await deleteRefs(run.root, run.runId); active = undefined; return; }
      const current = await mode(run.root); const files = (await command(run.root, ["diff", "--name-only", run.baseTree, end.tree])).stdout.split("\n").filter(Boolean).map((file) => ({ file }));
      const record: Pending = { runId: run.runId, base: run.base, baseTree: run.baseTree, end: end.commit, endTree: end.tree, files, startedAt: run.startedAt, endedAt: new Date().toISOString(), modeMtimeMs: run.modeMtimeMs };
      if (modeTampered(run.modeMtimeMs, current.mtime)) { record.tamper = true; await forceOn(run.root); }
      await refs(run.root, run.runId, run.base, end.commit); await atomic(path(run.root, "pending", `${run.runId}.json`), record); active = undefined; ctx.ui.setStatus("agent-review", "review pending — :AgentReview in nvim");
    } catch (error) {
      const id = run.runId; const record: Pending = { runId: id, base: run.base, baseTree: run.baseTree, end: run.base, endTree: run.baseTree, files: [], startedAt: run.startedAt, endedAt: new Date().toISOString(), modeMtimeMs: run.modeMtimeMs, error: String(error) };
      await atomic(path(run.root, "pending", `${id}.json`), record); active = undefined; ctx.ui.notify("Agent review snapshot failed; review remains pending", "error");
    }
  };
  const processDecision = async (ctx: ExtensionContext, root: string, id: string) => {
    if (!validRunId(id) || inflight.has(id)) return; inflight.add(id); const file = path(root, "pending", `${id}.json`), processing = path(root, "pending", `${id}.processing`);
    try { await rename(file, processing); const record = await json<Pending>(processing); const decision = await json<Decision>(path(root, "decisions", `${id}.json`)); if (!record || !decision) throw new Error("invalid review record"); const final = await snapshot(root, "agent-review-final-check"); if (!validDecision(record, decision, final.tree)) throw new Error("stale or forged decision"); await rm(processing, { force: true }); await deleteRefs(root, id); if (needsFollowUp(decision)) pi.sendUserMessage(`Review of run ${id} is complete. Decisions, notes and the reviewer's patch: .pi/agent-review/decisions/${id}.json. Re-read the listed files before further changes. Do not reintroduce rejected changes.`, { deliverAs: "followUp" }); ctx.ui.setStatus("agent-review", undefined); }
    catch (error) { await rename(processing, file).catch(() => undefined); ctx.ui.notify(`Agent review decision ignored: ${String(error)}`, "warning"); }
    finally { inflight.delete(id); }
  };
  pi.on("input", async (event, ctx) => { const root = await repoRoot(ctx.cwd); const blocked = await pending(root); if (blocked.length) { ctx.ui.notify(`Review pending — /review skip ${blocked[0].runId} to continue`, "warning"); return { action: "handled" as const }; } if (event.source === "extension") return { action: "continue" as const }; const selected = await mode(root); if (selected.mode === "off" || active) return { action: "continue" as const }; const base = await snapshot(root, "agent-review-base"); const id = randomUUID(); await refs(root, id, base.commit); active = { runId: id, root, base: base.commit, baseTree: base.tree, startedAt: new Date().toISOString(), modeMtimeMs: selected.mtime }; verifierDone = false; latestCtx = ctx; if (timer) clearTimeout(timer); return { action: "continue" as const }; });
  pi.events.on("post-run-verifier:settled", () => { verifierDone = true; if (latestCtx) void finish(latestCtx); });
  pi.on("agent_settled", async (_event, ctx) => { latestCtx = ctx; if (timer) clearTimeout(timer); timer = setTimeout(() => { verifierDone = true; void finish(ctx); }, 30_000); await finish(ctx); });
  pi.registerCommand("review", { description: "List reviews or skip one", handler: async (args, ctx) => { const root = await repoRoot(ctx.cwd); const [verb, id] = args.trim().split(/\s+/, 2); const records = await pending(root); if (verb === "skip" && validRunId(id)) { const record = records.find((r) => r.runId === id); if (!record) return ctx.ui.notify("Unknown review", "warning"); const final = await snapshot(root, "agent-review-skip"); await atomic(path(root, "decisions", `${id}.json`), { runId: id, endTree: record.endTree, finalTree: final.tree, files: [], notes: [], patch: "", skipped: true } satisfies Decision); return; } ctx.ui.notify(records.length ? `Pending reviews: ${records.map((r) => r.runId).join(", ")}` : "No pending reviews", "info"); } });
  pi.on("session_start", async (_event, ctx) => { const root = await repoRoot(ctx.cwd); await mkdir(path(root, "decisions"), { recursive: true }); const records = await pending(root); if (records.length) ctx.ui.setStatus("agent-review", "review pending — :AgentReview in nvim"); watcher?.close(); watcher = watch(path(root, "decisions"), (_event, name) => { const id = typeof name === "string" ? basename(name, ".json") : ""; if (id) void processDecision(ctx, root, id); }); });
  pi.on("session_shutdown", () => { watcher?.close(); if (timer) clearTimeout(timer); });
}
