import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createConnection } from "node:net";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";

const execFileAsync = promisify(execFile);
const paneScript = fileURLToPath(new URL("./status-pane.mjs", import.meta.url));

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export const statePath = (cwd: string) => join(cwd, ".pi", "panel.state.json");

export interface PanelConfig {
	/** tmux supports either an absolute column count or a percentage such as "25%". */
	width: string;
	autoOpen: boolean;
}

export function loadPanelConfig(env: NodeJS.ProcessEnv = process.env): PanelConfig {
	const configured = env.PI_PANEL_WIDTH?.trim();
	const columns = configured && /^\d+$/.test(configured) ? Number(configured) : undefined;
	const percent = configured && /^(?:1[5-9]|[2-4]\d|50)%$/.test(configured);
	return {
		// A percentage tracks the tmux window width; an explicit 16–60 column
		// value remains available for users who prefer a fixed-size panel.
		width: percent ? configured : columns && columns >= 16 && columns <= 60 ? configured! : "25%",
		autoOpen: env.PI_PANEL_AUTO !== "0",
	};
}

// ── Herdr transport ────────────────────────────────────────────────────────
// Herdr renders its own pane layout inside a single outer tmux window, so a
// raw `tmux split-window` from a Herdr-hosted Pi lands in the *outer* tmux
// session — an invisible or unrelated window. Herdr exposes a JSON-lines
// socket API (HERDR_SOCKET_PATH) plus the hosting pane id (HERDR_PANE_ID);
// this is the same transport Herdr's own Pi integration (herdr-agent-state)
// uses. When Herdr is detected it always wins over tmux.

export interface HerdrTarget {
	socket: string;
	paneId: string;
}

export function herdrTarget(env: NodeJS.ProcessEnv = process.env): HerdrTarget | undefined {
	if (env.HERDR_ENV !== "1") return undefined;
	const socket = env.HERDR_SOCKET_PATH;
	const paneId = env.HERDR_PANE_ID;
	return socket && paneId ? { socket, paneId } : undefined;
}

/** Single request/response against Herdr's newline-delimited JSON socket. */
function herdrCall(
	socket: string,
	method: string,
	params: Record<string, unknown>,
	timeoutMs = 3000,
): Promise<any> {
	return new Promise((resolve, reject) => {
		const conn = createConnection(socket);
		let buf = "";
		const finish = (fn: () => void) => {
			clearTimeout(timer);
			conn.destroy();
			fn();
		};
		const timer = setTimeout(
			() => finish(() => reject(new Error(`${method}: timed out`))),
			timeoutMs,
		);
		conn.on("error", (err) => finish(() => reject(err)));
		conn.on("connect", () =>
			conn.write(
				`${JSON.stringify({ id: `pi-side-panel:${method}:${Date.now()}`, method, params })}\n`,
			),
		);
		conn.on("data", (chunk) => {
			buf += chunk.toString("utf8");
			const newline = buf.indexOf("\n");
			if (newline < 0) return;
			const line = buf.slice(0, newline);
			finish(() => {
				try {
					const response = JSON.parse(line);
					if (response?.error) {
						reject(new Error(response.error.message ?? `${method} failed`));
					} else {
						resolve(response?.result);
					}
				} catch (err) {
					reject(err);
				}
			});
		});
	});
}

/** Panel share of the tab: "25%" → 0.25; fixed columns resolve against the live tab width. */
async function panelFraction(socket: string, width: string): Promise<number> {
	let fraction: number;
	if (width.endsWith("%")) {
		fraction = Number.parseInt(width, 10) / 100;
	} else {
		const layout = await herdrCall(socket, "pane.layout", {}).catch(() => undefined);
		const areaWidth = Number(layout?.layout?.area?.width);
		fraction = Number.isFinite(areaWidth) && areaWidth > 0 ? Number(width) / areaWidth : 0.25;
	}
	// Same usable band as the tmux config (15–50% / 16–60 cols).
	return Math.min(0.5, Math.max(0.1, fraction));
}

async function spawnHerdr(ctx: any, target: HerdrTarget): Promise<string> {
	const config = loadPanelConfig();
	const fraction = await panelFraction(target.socket, config.width);
	// Herdr's ratio is the share the *existing* pane keeps — the new pane gets
	// the remainder — so a 25% panel means ratio 0.75.
	const result = await herdrCall(target.socket, "pane.split", {
		direction: "right",
		target_pane_id: target.paneId,
		ratio: 1 - fraction,
		cwd: ctx.cwd,
		focus: false,
	});
	const id = result?.pane?.pane_id;
	if (typeof id !== "string" || !id) throw new Error("pane.split returned no pane id");
	// Herdr panes start a login shell; `exec` replaces it so the pane dies with
	// the panel process, matching tmux split-window <command> semantics. The
	// PTY buffers input, so this lands even before the shell prompt is ready.
	const sessionId = ctx.sessionManager?.getSessionId?.() ?? "";
	const args = [process.execPath, paneScript, "--cwd", ctx.cwd, "--session", sessionId];
	const command = `exec ${args.map(quote).join(" ")}`;
	try {
		await herdrCall(target.socket, "pane.send_text", { pane_id: id, text: `${command}\r` });
	} catch (err) {
		await herdrCall(target.socket, "pane.close", { pane_id: id }).catch(() => undefined);
		throw err;
	}
	return id;
}

export default function piSidePanelExtension(pi: ExtensionAPI) {
	let active: { transport: "tmux" | "herdr"; id: string; socket?: string } | undefined;

	async function spawn(ctx: any): Promise<boolean> {
		if (active || !ctx.hasUI || ctx.mode !== "tui") return false;
		const herdr = herdrTarget();
		if (!herdr && !process.env.TMUX) return false;
		try {
			if (herdr) {
				active = { transport: "herdr", id: await spawnHerdr(ctx, herdr), socket: herdr.socket };
			} else {
				const config = loadPanelConfig();
				const sessionId = ctx.sessionManager?.getSessionId?.() ?? "";
				// The panel is read-only: main Pi shortcuts own all state-changing actions.
				const args = [process.execPath, paneScript, "--cwd", ctx.cwd, "--session", sessionId];
				const command = args.map(quote).join(" ");
				const target = process.env.TMUX_PANE ? ["-t", process.env.TMUX_PANE] : [];
				const { stdout } = await execFileAsync("tmux", [
					"split-window", "-h", "-d", "-P", "-F", "#{pane_id}",
					"-l", String(config.width), ...target, "-c", ctx.cwd, command,
				]);
				const id = stdout.trim();
				if (!id) return false;
				active = { transport: "tmux", id };
			}
		} catch {
			active = undefined;
			return false;
		}
		await mkdir(join(ctx.cwd, ".pi"), { recursive: true });
		await writeFile(statePath(ctx.cwd), JSON.stringify({
			active: true, paneId: active.id, startedAt: new Date().toISOString(),
		}));
		// pi-live-status may have rendered before the panel heartbeat existed.
		// The panel owns detailed session telemetry while it is visible.
		const clearDuplicateStatuses = () => {
			ctx.ui.setStatus("pi-live-status", undefined);
			ctx.ui.setWidget("pi-live-status", undefined);
		};
		clearDuplicateStatuses();
		setTimeout(clearDuplicateStatuses, 300);
		return true;
	}

	async function close(cwd: string): Promise<void> {
		const current = active;
		active = undefined;
		if (current?.transport === "tmux") {
			await execFileAsync("tmux", ["kill-pane", "-t", current.id]).catch(() => undefined);
		} else if (current?.transport === "herdr" && current.socket) {
			await herdrCall(current.socket, "pane.close", { pane_id: current.id }).catch(() => undefined);
		}
		await rm(statePath(cwd), { force: true }).catch(() => undefined);
	}

	pi.registerCommand("panel", {
		description: "Toggle the persistent side panel (session/review/verification/git dashboard)",
		handler: async (_args, ctx) => {
			if (active) {
				await close(ctx.cwd);
				ctx.ui.notify("pi-side-panel closed", "info");
				return;
			}
			if (await spawn(ctx)) ctx.ui.notify("pi-side-panel opened", "info");
			else ctx.ui.notify("pi-side-panel unavailable (requires tmux or herdr + TUI)", "warning");
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		if (loadPanelConfig().autoOpen) await spawn(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		await close(ctx.cwd);
	});
}
