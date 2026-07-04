import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Key, matchesKey, truncateToWidth, type Component } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
	backupWorktree,
	color,
	C,
	dim,
	execCmd,
	expandHome,
	gitHistory,
	gitSnapshot,
	padVisible,
	readJsonObject,
	writeWorktreeHandoff,
	type BranchInfo,
	type GitSnapshot,
	type WorktreeInfo,
	type WorkflowGitConfig,
} from "./git-helpers";

const execFileAsync = promisify(execFile);

type Pane = "worktrees" | "branches" | "history";
type Action =
	| { type: "open"; path: string }
	| { type: "reveal"; path: string }
	| { type: "remove"; path: string }
	| { type: "prune" }
	| { type: "handoff"; path: string }
	| { type: "refresh" }
	| { type: "quit" };

interface WorkflowConfig {
	gitview?: WorkflowGitConfig;
}

async function readWorkflowConfig(cwd: string): Promise<WorkflowConfig> {
	const cfg: Record<string, unknown> = {};
	Object.assign(cfg, await readJsonObject(join(homedir(), ".config", "agent-workflow", "config.json")));
	try {
		const { stdout } = await execFileAsync("git", ["-C", cwd, "rev-parse", "--git-common-dir"], { timeout: 2000 });
		const { resolve, dirname } = await import("node:path");
		let common = stdout.trim();
		if (!common.startsWith("/")) common = resolve(cwd, common);
		const root = dirname(common);
		Object.assign(cfg, await readJsonObject(join(root, ".agent-workflow.json")));
		Object.assign(cfg, await readJsonObject(join(root, ".agent-workflow.local.json")));
	} catch {
		/* ignore */
	}
	return cfg as WorkflowConfig;
}

async function revealPath(path: string): Promise<void> {
	if (process.platform === "darwin") await execFileAsync("open", [path], { timeout: 5000 });
	else if (process.platform === "linux") await execFileAsync("xdg-open", [path], { timeout: 5000 });
	else await execFileAsync("cmd", ["/c", "start", "", path], { timeout: 5000 });
}

function fmtAheadBehind(item: { ahead?: number; behind?: number }): string {
	const parts: string[] = [];
	if ((item.ahead ?? 0) > 0) parts.push(color(`↑${item.ahead}`, C.green));
	if ((item.behind ?? 0) > 0) parts.push(color(`↓${item.behind}`, C.yellow));
	return parts.join(" ");
}

function rowState(wt: WorktreeInfo): string {
	const parts: string[] = [];
	if (wt.active) parts.push(color("active", C.green));
	if (wt.stale) parts.push(color("stale", C.peach));
	if (wt.dirty) parts.push(color(`dirty:${wt.statusCount}`, C.red));
	if (wt.locked) parts.push(color("locked", C.yellow));
	if (wt.detached) parts.push(dim("detached"));
	return parts.join(" ") || dim("clean");
}

class GitBrowser implements Component {
	private pane: Pane = "worktrees";
	private selected = 0;
	private historyLines: string[] = [];
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private snapshot: GitSnapshot,
		private historyDepth: number,
		private done: (action: Action) => void,
	) {
		void this.loadHistory();
	}

	handleInput(data: string): void {
		if (matchesKey(data, Key.escape) || data === "q") return this.done({ type: "quit" });
		if (matchesKey(data, Key.tab)) return this.setPane(this.nextPane());
		if (matchesKey(data, Key.shift("tab"))) return this.setPane(this.prevPane());
		if (matchesKey(data, Key.up)) return this.move(-1);
		if (matchesKey(data, Key.down)) return this.move(1);
		if (data === "r") return this.done({ type: "refresh" });
		if (data === "p") return this.done({ type: "prune" });
		const target = this.currentPath();
		if ((data === "o" || matchesKey(data, Key.enter)) && target) return this.done({ type: "open", path: target });
		if (data === "O" && target) return this.done({ type: "reveal", path: target });
		if (data === "d" && target && this.pane === "worktrees") return this.done({ type: "remove", path: target });
		if (data === "h" && target && this.pane === "worktrees") return this.done({ type: "handoff", path: target });
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		const lines: string[] = [];
		lines.push(color("Git Worktrees / Branches", C.lavender) + dim(`  repo ${this.snapshot.repoRoot}`));
		lines.push(dim("tab panes • ↑↓ select • enter/o open • O reveal • h handoff • d remove • p prune • r refresh • q close"));
		lines.push(dim(`default branch: ${this.snapshot.defaultBranch}  pane: ${this.pane}`));
		lines.push("");
		if (this.pane === "worktrees") this.renderWorktrees(lines, width);
		else if (this.pane === "branches") this.renderBranches(lines, width);
		else this.renderHistory(lines, width);
		this.cachedWidth = width;
		this.cachedLines = lines.map((line) => truncateToWidth(line, width));
		return this.cachedLines;
	}

	invalidate(): void {
		this.cachedLines = undefined;
		this.cachedWidth = undefined;
	}

	private renderWorktrees(lines: string[], width: number): void {
		if (!this.snapshot.worktrees.length) {
			lines.push(dim("No worktrees."));
			return;
		}
		lines.push(dim("  branch                         age        ab       state             path"));
		this.snapshot.worktrees.forEach((wt, i) => {
			const prefix = i === this.selected ? color("›", C.teal) : " ";
			const branch = wt.branch || wt.head || "detached";
			const line = `${prefix} ${branch.padEnd(30).slice(0, 30)} ${(wt.lastCommitRelative || "?").padEnd(10).slice(0, 10)} ${padVisible(fmtAheadBehind(wt), 12)} ${padVisible(rowState(wt), 25)} ${wt.relPath}`;
			lines.push(truncateToWidth(line, width));
		});
	}

	private renderBranches(lines: string[], width: number): void {
		if (!this.snapshot.branches.length) {
			lines.push(dim("No branches."));
			return;
		}
		lines.push(dim("  branch                         age        ab       state        subject"));
		this.snapshot.branches.forEach((br, i) => {
			const prefix = i === this.selected ? color("›", C.teal) : " ";
			const state = [br.worktreePath ? color("wt", C.green) : "", br.merged ? dim("merged") : "", br.stale ? color("stale", C.peach) : ""].filter(Boolean).join(" ") || dim("local");
			const line = `${prefix} ${br.name.padEnd(30).slice(0, 30)} ${br.lastCommitRelative.padEnd(10).slice(0, 10)} ${padVisible(fmtAheadBehind(br), 12)} ${padVisible(state, 13)} ${br.subject}`;
			lines.push(truncateToWidth(line, width));
		});
	}

	private renderHistory(lines: string[], width: number): void {
		lines.push(dim(`History for ${this.currentRef() || "HEAD"}`));
		for (const line of this.historyLines.slice(0, this.historyDepth)) lines.push(truncateToWidth(line, width));
	}

	private setPane(pane: Pane): void {
		this.pane = pane;
		this.selected = Math.min(this.selected, this.maxIndex());
		this.invalidate();
		void this.loadHistory();
	}

	private nextPane(): Pane {
		return this.pane === "worktrees" ? "branches" : this.pane === "branches" ? "history" : "worktrees";
	}

	private prevPane(): Pane {
		return this.pane === "worktrees" ? "history" : this.pane === "history" ? "branches" : "worktrees";
	}

	private move(delta: number): void {
		this.selected = Math.max(0, Math.min(this.maxIndex(), this.selected + delta));
		this.invalidate();
		void this.loadHistory();
	}

	private maxIndex(): number {
		if (this.pane === "branches") return Math.max(0, this.snapshot.branches.length - 1);
		return Math.max(0, this.snapshot.worktrees.length - 1);
	}

	private currentWorktree(): WorktreeInfo | undefined {
		return this.snapshot.worktrees[this.selected];
	}

	private currentBranch(): BranchInfo | undefined {
		return this.snapshot.branches[this.selected];
	}

	private currentPath(): string | undefined {
		if (this.pane === "branches") return this.currentBranch()?.worktreePath || this.snapshot.repoRoot;
		return this.currentWorktree()?.path;
	}

	private currentRef(): string | undefined {
		if (this.pane === "branches") return this.currentBranch()?.name;
		return this.currentWorktree()?.branch || this.currentWorktree()?.head;
	}

	private async loadHistory(): Promise<void> {
		const cwd = this.currentPath() || this.snapshot.repoRoot;
		const ref = this.pane === "branches" ? this.currentRef() || "HEAD" : "HEAD";
		this.historyLines = await gitHistory(cwd, ref, this.historyDepth);
		this.invalidate();
	}
}

async function showGitBrowser(pi: ExtensionAPI, args: string, ctx: any): Promise<void> {
	const cfg = await readWorkflowConfig(ctx.cwd);
	const gitCfg = cfg.gitview || {};
	const staleDays = gitCfg.staleDays ?? 14;
	const historyDepth = gitCfg.historyDepth ?? 20;
	const multiRepo = args.includes("--all") || gitCfg.multiRepo === true;
	const repos = multiRepo && gitCfg.repos?.length ? gitCfg.repos.map((repo) => expandHome(repo, homedir())) : [ctx.cwd];
	for (const repo of repos) {
		let doneAction: Action | undefined;
		const snapshot = await gitSnapshot(repo, { staleDays, historyDepth });
		if (!ctx.hasUI || ctx.mode !== "tui") {
			ctx.ui.notify(`worktrees: ${snapshot.worktrees.length}, branches: ${snapshot.branches.length}`, "info");
			continue;
		}
		await ctx.ui.custom<void>((tui: any, _theme: any, _kb: any, done: any) => {
			const component = new GitBrowser(snapshot, historyDepth, (action) => {
				doneAction = action;
				done(undefined);
			});
			return {
				render: (width: number) => component.render(width),
				invalidate: () => component.invalidate(),
				handleInput: (data: string) => {
					component.handleInput(data);
					tui.requestRender();
				},
			};
		}, { overlay: true, overlayOptions: { width: "90%", maxHeight: "85%", anchor: "center", margin: 1 } });
		if (!doneAction || doneAction.type === "quit") continue;
		if (doneAction.type === "refresh") {
			await showGitBrowser(pi, args, ctx);
			return;
		}
		if (doneAction.type === "open" || doneAction.type === "reveal") {
			await revealPath(doneAction.path);
			ctx.ui.notify(`Opened ${doneAction.path}`, "info");
		}
		if (doneAction.type === "handoff") {
			const marker = await writeWorktreeHandoff({ cwd: ctx.cwd, targetWorktree: doneAction.path, action: "operate", sourceSession: ctx.sessionManager?.getSessionFile?.() });
			pi.sendUserMessage(`Operate in git worktree: ${doneAction.path}\n\nBefore editing, read the handoff marker ${marker}, verify git status/ahead-behind/untracked files, and preserve a backup/checkpoint before destructive operations.`, { deliverAs: "followUp" });
			ctx.ui.notify(`Queued worktree handoff: ${marker}`, "info");
		}
		if (doneAction.type === "prune") {
			const ok = await ctx.ui.confirm("Prune worktrees?", "Run `git worktree prune` for the current repository? This only removes stale administrative records.");
			if (ok) {
				const result = await execCmd("git", ["-C", snapshot.repoRoot, "worktree", "prune", "--verbose"], snapshot.repoRoot, 10000);
				ctx.ui.notify(result.stdout || result.stderr || "Pruned worktrees", result.code === 0 ? "info" : "warning");
			}
		}
		if (doneAction.type === "remove") {
			const backup = await backupWorktree(doneAction.path, ctx.sessionManager?.getSessionFile?.());
			const ok = await ctx.ui.confirm("Remove worktree?", `Backup written to ${backup}\n\nRemove ${doneAction.path}?`);
			if (ok) {
				const result = await execCmd("git", ["-C", snapshot.repoRoot, "worktree", "remove", doneAction.path], snapshot.repoRoot, 15000);
				ctx.ui.notify(result.stdout || result.stderr || "Removed worktree", result.code === 0 ? "info" : "warning");
			} else {
				ctx.ui.notify(`Cancelled. Backup remains at ${backup}`, "info");
			}
		}
	}
}

export default function piGitView(pi: ExtensionAPI) {
	pi.registerCommand("worktrees", {
		description: "Open git worktree/branch viewer. Args: [--all]",
		handler: async (args, ctx) => showGitBrowser(pi, args || "", ctx),
	});
	pi.registerCommand("wt", {
		description: "Alias for /worktrees",
		handler: async (args, ctx) => showGitBrowser(pi, args || "", ctx),
	});
	pi.registerCommand("git", {
		description: "Alias for /worktrees",
		handler: async (args, ctx) => showGitBrowser(pi, args || "", ctx),
	});
}
