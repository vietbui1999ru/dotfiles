import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { homedir } from "node:os";
import { promisify } from "node:util";
import {
	commandrBus,
	gitSnapshot,
	readJsonObject,
} from "../extensions/git-helpers";

const execFileAsync = promisify(execFile);

interface ControlConfig {
	controlPlane?: {
		enabled?: boolean;
		host?: string;
		port?: number;
		openBrowser?: boolean;
		multiRepo?: boolean;
	};
	obsidianVault?: string;
	obsidianCli?: string;
	obsidianFolders?: Record<string, string>;
	gitview?: { staleDays?: number; historyDepth?: number };
}

let server: ReturnType<typeof createServer> | undefined;
let serverUrl = "";

async function readConfig(cwd: string): Promise<ControlConfig> {
	const cfg: Record<string, unknown> = {};
	Object.assign(
		cfg,
		await readJsonObject(
			join(homedir(), ".config", "agent-workflow", "config.json"),
		),
	);
	try {
		const { stdout } = await execFileAsync(
			"git",
			["-C", cwd, "rev-parse", "--git-common-dir"],
			{ timeout: 2000 },
		);
		let common = stdout.trim();
		if (!common.startsWith("/")) common = resolve(cwd, common);
		const root = common
			.replace(/\/\.git$/, "")
			.replace(/\/\.git\/worktrees\/[^/]+$/, "");
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
	return cfg as ControlConfig;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body, null, 2));
}

function sendHtml(res: ServerResponse, body: string): void {
	res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	res.end(body);
}

async function laneFiles(dir: string): Promise<string[]> {
	try {
		return (await readdir(dir)).filter((x) => x.endsWith(".md")).sort();
	} catch {
		return [];
	}
}

async function commandrTasks(cwd: string) {
	const bus = await commandrBus(cwd);
	if (!bus) return { bus: null, inbox: [], claimed: [], done: [] };
	return {
		bus,
		inbox: await laneFiles(join(bus, "inbox")),
		claimed: await laneFiles(join(bus, "claimed")),
		done: await laneFiles(join(bus, "done")),
	};
}

async function commandrEvents(cwd: string) {
	const bus = await commandrBus(cwd);
	if (!bus) return [];
	try {
		const raw = await readFile(join(bus, "events.jsonl"), "utf8");
		return raw
			.split("\n")
			.filter(Boolean)
			.slice(-200)
			.flatMap((line) => {
				try {
					return [JSON.parse(line)];
				} catch {
					return [{ parse_error: line }];
				}
			});
	} catch {
		return [];
	}
}

function expandVault(path?: string): string {
	// Env vars override
	const envVault =
		process.env.AGENTOPS_VAULT || process.env.PI_OBSIDIAN_VAULT || "";
	if (envVault) return resolve(envVault.replace(/^~\//, homedir() + "/"));
	const raw = path || "~/repos/AgentOps";
	return resolve(raw.replace(/^~(?=\/|$)/, homedir()));
}

async function obsidianNotes(cfg: ControlConfig) {
	const vault = expandVault(cfg.obsidianVault);
	const folders = Object.values(
		cfg.obsidianFolders || {
			spec: "Sessions/Specs",
			plan: "Sessions/Plans",
			review: "Sessions/Reviews",
			note: "Sessions/Inbox",
		},
	);
	const seen = new Set<string>();
	const notes: Array<{
		path: string;
		name: string;
		mtime: string;
		size: number;
	}> = [];
	for (const folder of folders) {
		if (seen.has(folder)) continue;
		seen.add(folder);
		const dir = join(vault, folder);
		if (!existsSync(dir)) continue;
		for (const file of await readdir(dir)) {
			if (!file.endsWith(".md")) continue;
			const abs = join(dir, file);
			const st = await stat(abs);
			notes.push({
				path: relative(vault, abs),
				name: file,
				mtime: st.mtime.toISOString(),
				size: st.size,
			});
		}
	}
	return notes.sort((a, b) => b.mtime.localeCompare(a.mtime)).slice(0, 100);
}

async function obsidianCli(cfg: ControlConfig, vault: string, args: string[]) {
	const candidates = [cfg.obsidianCli, "obsidian", "obsidian-cli"].filter(
		Boolean,
	) as string[];
	for (const cli of candidates) {
		try {
			const { stdout } = await execFileAsync(cli, args, {
				cwd: vault,
				timeout: 5000,
				maxBuffer: 4 * 1024 * 1024,
			});
			return { ok: true, stdout };
		} catch {
			/* try next */
		}
	}
	return { ok: false, stdout: "", error: "Obsidian CLI not found" };
}

function page(): string {
	return `<!doctype html>
<html><head><meta charset="utf-8"><title>Pi Cockpit</title>
<style>
body{font:14px ui-monospace,SFMono-Regular,Menlo,monospace;background:#1e2030;color:#cad3f5;margin:0;padding:16px}h1{margin:0 0 12px}.grid{display:grid;grid-template-columns:repeat(3,minmax(280px,1fr));gap:12px}.card{background:#24273a;border:1px solid #494d64;border-radius:8px;padding:12px;min-height:220px;max-height:46vh;overflow:auto}button{background:#8aadf4;color:#111;border:0;border-radius:4px;padding:4px 8px;margin-left:8px;cursor:pointer}pre{white-space:pre-wrap}.muted{color:#6e738d}.error{color:#ed8796}.item{border-bottom:1px solid #363a4f;padding:6px 0}.path{overflow-wrap:anywhere}</style>
</head><body><h1>Pi Local Cockpit</h1><p class="muted">Commandr bus • Git worktrees • Obsidian notes • <span id="status">loading…</span><button id="refreshBtn">refresh now</button></p><div class="grid"><div class="card"><h2>Commandr</h2><pre id="tasks">loading…</pre></div><div class="card"><h2>Git</h2><pre id="git">loading…</pre></div><div class="card"><h2>Obsidian Notes</h2><div id="notes">loading…</div></div></div><div class="card" style="margin-top:12px"><h2>Events</h2><pre id="events">loading…</pre></div>
<script>
const REFRESH_MS=60000;
const el=(id)=>document.getElementById(id);
async function j(url){
 const r=await fetch(url,{cache:'no-store'});
 if(!r.ok) throw new Error(url+' -> HTTP '+r.status);
 return r.json();
}
function show(id,value){el(id).classList.remove('error');el(id).textContent=typeof value==='string'?value:JSON.stringify(value,null,2)}
function showError(id,error){el(id).textContent=String(error);el(id).classList.add('error')}
async function loadOne(id,url,render=(x)=>x){try{const data=await j(url);show(id,render(data));return data}catch(e){showError(id,e);return null}}
function renderNotes(notes){
 const root=el('notes'); root.replaceChildren();
 if(!Array.isArray(notes)||notes.length===0){root.textContent='none';return;}
 for(const n of notes){
  const row=document.createElement('div'); row.className='item';
  const btn=document.createElement('button'); btn.textContent='open'; btn.onclick=()=>openNote(n.path);
  const path=document.createElement('span'); path.className='path'; path.textContent=' '+n.path;
  const meta=document.createElement('div'); meta.className='muted'; meta.textContent=(n.mtime||'?')+' • '+(n.size||0)+' bytes';
  row.append(btn,path,document.createElement('br'),meta); root.append(row);
 }
}
let refreshing=false;
let timer=null;
async function refresh(reason='manual'){
 if(refreshing) return;
 refreshing=true;
 el('status').textContent='refreshing…';
 try{
  await Promise.all([
   loadOne('tasks','/api/commandr/tasks'),
   loadOne('git','/api/git/worktrees',(git)=>({defaultBranch:git.defaultBranch,worktrees:git.worktrees?.map(w=>({path:w.relPath,branch:w.branch,dirty:w.dirty,stale:w.stale,age:w.lastCommitRelative}))})),
   j('/api/obsidian/notes').then((x)=>{el('notes').classList.remove('error');renderNotes(x);return x}).catch((e)=>{el('notes').textContent=String(e);el('notes').classList.add('error');return null}),
   loadOne('events','/api/commandr/events',(events)=>Array.isArray(events)?events.slice(-50):events),
  ]);
  el('status').textContent='updated '+new Date().toLocaleTimeString()+' ('+reason+'; next ~'+Math.round(REFRESH_MS/60000)+'m)';
 } finally {
  refreshing=false;
  schedule();
 }
}
function schedule(){
 if(timer) clearTimeout(timer);
 timer=setTimeout(()=>{ if(!document.hidden) refresh('timer'); else schedule(); }, REFRESH_MS);
}
async function openNote(path){await fetch('/api/obsidian/open-note',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({path})});}
el('refreshBtn').onclick=()=>refresh('button');
document.addEventListener('visibilitychange',()=>{ if(!document.hidden) refresh('visible'); });
window.addEventListener('focus',()=>refresh('focus'));
refresh('initial');
</script></body></html>`;
}

async function readBody(
	req: IncomingMessage,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	for await (const chunk of req) chunks.push(Buffer.from(chunk));
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
	} catch {
		return {};
	}
}

async function route(
	req: IncomingMessage,
	res: ServerResponse,
	cwd: string,
): Promise<void> {
	const cfg = await readConfig(cwd);
	const url = new URL(req.url || "/", "http://localhost");
	if (url.pathname === "/") return sendHtml(res, page());
	if (url.pathname === "/api/health")
		return sendJson(res, 200, { ok: true, cwd, ts: new Date().toISOString() });
	if (url.pathname === "/api/commandr/tasks")
		return sendJson(res, 200, await commandrTasks(cwd));
	if (url.pathname === "/api/commandr/events")
		return sendJson(res, 200, await commandrEvents(cwd));
	if (url.pathname === "/api/git/worktrees")
		return sendJson(res, 200, await gitSnapshot(cwd, cfg.gitview || {}));
	if (url.pathname === "/api/obsidian/notes")
		return sendJson(res, 200, await obsidianNotes(cfg));
	if (url.pathname === "/api/obsidian/history") {
		const vault = expandVault(cfg.obsidianVault);
		const path = url.searchParams.get("path") || "";
		return sendJson(
			res,
			200,
			await obsidianCli(cfg, vault, ["history", `path=${path}`]),
		);
	}
	if (url.pathname === "/api/obsidian/diff") {
		const vault = expandVault(cfg.obsidianVault);
		const path = url.searchParams.get("path") || "";
		const from = url.searchParams.get("from") || "1";
		const to = url.searchParams.get("to");
		return sendJson(
			res,
			200,
			await obsidianCli(cfg, vault, [
				"diff",
				`path=${path}`,
				`from=${from}`,
				...(to ? [`to=${to}`] : []),
			]),
		);
	}
	if (req.method === "POST" && url.pathname === "/api/obsidian/open-note") {
		const body = await readBody(req);
		const vault = expandVault(cfg.obsidianVault);
		return sendJson(
			res,
			200,
			await obsidianCli(cfg, vault, [
				"open",
				`path=${String(body.path || "")}`,
			]),
		);
	}
	if (req.method === "POST" && url.pathname === "/api/obsidian/open-history") {
		const body = await readBody(req);
		const vault = expandVault(cfg.obsidianVault);
		return sendJson(
			res,
			200,
			await obsidianCli(cfg, vault, [
				"history:open",
				`path=${String(body.path || "")}`,
			]),
		);
	}
	return sendJson(res, 404, { error: "not found" });
}

async function startControlPlane(ctx: any): Promise<string> {
	if (server) return serverUrl;
	const cfg = await readConfig(ctx.cwd);
	const host = cfg.controlPlane?.host || "127.0.0.1";
	const port = cfg.controlPlane?.port || 3340;
	server = createServer(
		(req, res) =>
			void route(req, res, ctx.cwd).catch((error) =>
				sendJson(res, 500, { error: String(error) }),
			),
	);
	await new Promise<void>((resolveListen) =>
		server!.listen(port, host, resolveListen),
	);
	serverUrl = `http://${host}:${port}`;
	if (cfg.controlPlane?.openBrowser !== false) {
		try {
			if (process.platform === "darwin")
				await execFileAsync("open", [serverUrl], { timeout: 5000 });
			else if (process.platform === "linux")
				await execFileAsync("xdg-open", [serverUrl], { timeout: 5000 });
		} catch {
			/* ignore */
		}
	}
	return serverUrl;
}

async function stopControlPlane(): Promise<boolean> {
	const active = server;
	if (!active) return false;
	await new Promise<void>((resolveClose) => active.close(() => resolveClose()));
	server = undefined;
	serverUrl = "";
	return true;
}

export default function piControlPlane(pi: ExtensionAPI) {
	async function openControlPlane(ctx: any) {
		const url = await startControlPlane(ctx);
		ctx.ui.notify(`Control plane: ${url}`, "info");
	}

	async function closeControlPlane(ctx: any): Promise<boolean> {
		const stopped = await stopControlPlane();
		ctx.ui.notify(
			stopped ? "Control plane stopped" : "Control plane was not running",
			stopped ? "info" : "warning",
		);
		return stopped;
	}

	pi.on("session_shutdown", async () => {
		await stopControlPlane();
	});

	pi.registerCommand("control-plane", {
		description:
			"Start/open local Commandr + DiffViewer + Obsidian control plane.",
		handler: async (_args, ctx) => openControlPlane(ctx),
	});
	pi.registerCommand("cp", {
		description: "Alias for /control-plane",
		handler: async (_args, ctx) => openControlPlane(ctx),
	});
	pi.registerCommand("cp-stop", {
		description:
			"Stop the local control-plane HTTP server but keep Pi running.",
		handler: async (_args, ctx) => {
			await closeControlPlane(ctx);
		},
	});
	pi.registerCommand("cp-exit", {
		description: "Stop control-plane server and exit this Pi session.",
		handler: async (_args, ctx) => {
			await closeControlPlane(ctx);
			ctx.shutdown();
		},
	});
	pi.registerCommand("cp-quit", {
		description: "Alias for /cp-exit",
		handler: async (_args, ctx) => {
			await closeControlPlane(ctx);
			ctx.shutdown();
		},
	});
}
