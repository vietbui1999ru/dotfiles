// The focus block (sidebar) and the Workspaces panel (overlay). The block shows the Work and
// Hobby slots and an attention line; a click opens the panel. The panel lists the focus board
// and, for each board repo, its worktrees and jj workspaces with actions. The board comes from
// `scripts/focus status --json`; git and gh data come from each repo's main worktree.
// Props: { role: "panel" } draws the panel; { actions: [...] } turns actions on (see logic.js).
// The view never fetches: `gh` runs at most every 5 minutes, and only its list is read.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, terminals, watchFolder, openOverlay, closeOverlay, props, run, nextCommand, theme, setShared } from "herdr";
import * as L from "./logic.js";

const FOCUS = (h) => `${h}/dotfiles/scripts/focus`;
// The merged label on a worktree row. Unknown is shown as such, never as not merged.
const MERGED_TAG = { merged: "merged", unknown: "merged?" };
const GH_TTL = 5 * 60 * 1000;
const ENABLED = L.enabledActions(props()?.actions);
const STAGES = ["spec", "plan", "build", "review", "merge"];

// --------------------------------------------------------------- data

// One board read. A missing board or a failed script leaves the view empty, never throws.
async function readBoard(h) {
	const r = await exec(FOCUS(h), ["status", "--json"], { timeout: 15000 }).catch(() => null);
	// Exit 1 means a cap breach, which is still data; anything else is a failed read.
	if (!r || (r.code !== 0 && r.code !== 1)) return { board: null, error: r?.stderr ?? "focus did not run" };
	try {
		const data = JSON.parse(r.stdout);
		return { board: data.no_board ? null : data, error: null };
	} catch {
		return { board: null, error: "focus status is not JSON" };
	}
}

// Merged PR branches per repo, cached for five minutes. A failed gh call returns null, so the
// caller falls back to `git branch --merged` and never reads a failure as "not merged".
const ghCache = new Map();
async function prMerged(repoPath, now = Date.now()) {
	const hit = ghCache.get(repoPath);
	if (hit && now - hit.at < GH_TTL) return hit.list;
	const r = await exec("gh", ["pr", "list", "--state", "merged", "--limit", "100", "--json", "headRefName"], { cwd: repoPath, timeout: 20000 }).catch(() => null);
	const list = r && r.code === 0 ? L.parsePrMerged(r.stdout) : null;
	ghCache.set(repoPath, { at: now, list });
	return list;
}

async function gitMergedFallback(repoPath) {
	const def = await exec("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], { cwd: repoPath, timeout: 10000 }).catch(() => null);
	const base = def?.code === 0 ? def.stdout.trim() : "main";
	const r = await exec("git", ["branch", "--merged", base, "--format=%(refname:short)"], { cwd: repoPath, timeout: 10000 }).catch(() => null);
	return r && r.code === 0 ? L.parseGitMerged(r.stdout) : null;
}

// One worktree's change count, ahead/behind and jj marker. Read-only commands only.
async function readRowState(row, changes, tracking) {
	const st = await exec("git", ["status", "--porcelain=v1", "-z", "--untracked-files=normal"], { cwd: row.path, timeout: 10000 }).catch(() => null);
	if (st?.code === 0) changes[row.path] = L.countChanges(st.stdout);
	const ab = await exec("git", ["rev-list", "--left-right", "--count", "@{u}...HEAD"], { cwd: row.path, timeout: 10000 }).catch(() => null);
	tracking[row.path] = L.parseAheadBehind(ab?.code === 0 ? ab.stdout : null);
	// jj: a .jj directory marks a jj workspace. Never run jj here (it would snapshot).
	row.jj = await exec("test", ["-d", `${row.path}/.jj`], { timeout: 3000 }).then((r) => r.code === 0).catch(() => false);
}

// One repo's worktrees with status, tracking, merged and live. Read-only git commands only.
async function repoRows(repoPath, cwds) {
	const wt = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repoPath, timeout: 10000 }).catch(() => null);
	if (!wt || wt.code !== 0) return { rows: [], error: "git worktree list failed" };
	const rows = L.parseWorktrees(wt.stdout);
	const changes = {}, tracking = {};
	await Promise.all(rows.map((row) => readRowState(row, changes, tracking)));
	const gh = await prMerged(repoPath);
	const merged = gh ? { prMerged: gh, gitMerged: [] } : { prMerged: null, gitMerged: await gitMergedFallback(repoPath) };
	const decorated = L.decorate(rows, { changes, tracking, merged, cwds });
	for (const r of decorated) r.jj = rows.find((x) => x.path === r.path)?.jj ?? false;
	return { rows: decorated, error: null };
}

// Terminal cwds of agent terminals, for live state. Only terminals with an agent status count.
function agentCwds() {
	return (terminals() ?? []).filter((t) => t.agent_status ?? t.agent).map((t) => t.cwd).filter(Boolean);
}

// --------------------------------------------------------------- actions (each argv, no shell)

// Board actions: re-read the board after each one.
async function boardAction(h, argv, label) {
	const r = await exec(argv[0], argv.slice(1), { timeout: 20000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
	return { ok: r.code === 0, message: r.code === 0 ? label : (r.stderr || r.stdout || "failed").trim() };
}

// Open a worktree: a terminal tab there, its changes in the Changes panel, and a coding agent.
function openWorktree(h, row, agent) {
	run("terminal.open", { argv: ["zsh"], folder: row.path, place: "tab" });
	setShared("pi-changes.run", null);
	run("layout.select", { stack: "panel-body", child: "changes" });
	run("layout.show", { id: "panel" });
	if (agent) run("terminal.open", { argv: L.AGENT_COMMANDS[agent], folder: row.path, place: "tab" });
	return { ok: true, message: `opened ${row.branch ?? row.path}` };
}

// New worktree: jw new <branch> in the repo's main worktree, then offer to switch focus to it.
async function newWorktree(h, repo, repoPath, rawBranch) {
	const branch = L.validBranch(rawBranch);
	if (!branch) return { ok: false, message: "That is not a usable branch name" };
	const r = await exec(L.jwNewArgv(h, branch)[0], L.jwNewArgv(h, branch).slice(1), { cwd: repoPath, timeout: 120000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
	if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout || "jw new failed").trim() };
	return { ok: true, message: `created ${branch}`, offerSwitch: { repo, branch } };
}

// Cleanup: remove each merged, managed, not-live worktree with jw rm. Never a branch, never force.
async function cleanupAll(h, rowsToClean, repoPath) {
	const results = [];
	for (const row of rowsToClean) {
		const argv = L.jwRemoveArgv(h, row);
		const r = await exec(argv[0], argv.slice(1), { cwd: repoPath, timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
		results.push({ path: row.path, ok: r.code === 0, message: r.code === 0 ? "removed" : (r.stderr || r.stdout || "refused").trim() });
	}
	return results;
}

// --------------------------------------------------------------- view

export default class Workspaces extends View {
	init(_p, cx) {
		this.isPanel = props()?.role === "panel";
		this.board = null; this.boardError = null; this.repos = {}; this.selected = null;
		this.note = null; this.busy = false; this.confirming = null; this.naming = null; this.branchName = "";
		this.refreshing = false;
		this.refresh(cx);
		cx.timer.every(10000, (cx) => this.refreshBoard(cx));
		cx.timer.every(30000, (cx) => this.refresh(cx));
		if (this.isPanel) this.watchBoard(cx);
		cx.spawn(async (cx) => {
			for (;;) {
				const c = await nextCommand();
				if (c === "open") this.openPanel();
				cx.notify();
			}
		});
	}

	// The board file's folder is watched: a write from focus (or Obsidian) re-reads at once.
	watchBoard(cx) {
		const dir = `${home()}/repos/Obsidian`;
		cx.spawn(async (cx) => {
			try {
				for (;;) { await watchFolder(dir); this.refreshBoard(cx); }
			} catch { /* no watch: the 10 s timer still refreshes */ }
		});
	}

	openPanel() {
		openOverlay({ mod: "workspaces", kind: "dialog", width: 640, props: { role: "panel", actions: props()?.actions } });
	}

	async refreshBoard(cx) {
		const { board, error } = await readBoard(home());
		this.board = board; this.boardError = error;
		cx.notify();
	}

	// Board, then each board repo's worktrees. One refresh at a time: a slow call never stacks.
	async refresh(cx) {
		if (this.refreshing) return;
		this.refreshing = true;
		try {
			await this.refreshBoard(cx);
			const cwds = agentCwds(), repos = {};
			for (const repo of this.board?.paths ? Object.keys(this.board.paths) : []) {
				repos[repo] = await repoRows(this.board.paths[repo], cwds);
			}
			this.repos = repos;
		} finally {
			this.refreshing = false;
			cx.notify();
		}
	}

	allRows() { return Object.values(this.repos).flatMap((r) => r.rows); }
	// Merged worktrees the cleanup action would remove, across every board repo.
	mergedCount() {
		if (!ENABLED.has("cleanup")) return 0;
		return Object.entries(this.repos).reduce((n, [name, data]) => n + L.cleanupRows(data.rows, this.board.paths[name]).length, 0);
	}

	// The sidebar block: Work and Hobby, then the attention line. A click opens the panel.
	block(t) {
		const slot = (label, item) => h_flex().h(20).gap(8).child(div().w(44).text_color(t.dim).text_size(11).child(label))
			.child(div().flex_1().min_w(0).truncate().child(item ? `${item.key}` : "—"))
			.when(!!item, (e) => e.child(div().text_color(t.dim).text_size(11).child(item.stage)));
		const attention = L.attentionText(this.board?.breaches ?? [], this.mergedCount());
		return v_flex().id("focus-block").size_full().px(12).py(8).gap(4).cursor_pointer().on_click(() => this.openPanel())
			.child(slot("Work", this.board?.work))
			.child(slot("Hobby", this.board?.hobby))
			.when(!!attention, (e) => e.child(div().text_color(t.accent).text_size(11).truncate().child(attention)));
	}

	// Board section: Work, Hobby, Frozen with stages; breaches; Parked lines.
	boardSection(t) {
		const b = this.board;
		if (!b) return div().text_color(t.dim).child(this.boardError ? `No focus board: ${this.boardError}` : "Reading the board…");
		const line = (label, item) => h_flex().h(22).gap(8).items_center()
			.child(div().w(56).text_color(t.dim).text_size(11).child(label))
			.child(div().flex_1().min_w(0).truncate().child(item ? item.key : "—"))
			.when(!!item && ENABLED.has("board"), (e) => e.child(this.stageButtons(t, item)))
			.when(!!item && ENABLED.has("board"), (e) => e.child(this.boardButtons(t, item)))
			.when(!!item && !ENABLED.has("board"), (e) => e.child(div().text_color(t.dim).text_size(11).child(item.stage)));
		return v_flex().gap(4)
			.child(line("Work", b.work)).child(line("Hobby", b.hobby))
			.children((b.frozen ?? []).map((item) => line("Frozen", item)))
			.children((b.breaches ?? []).map((text) => div().text_color(t.accent).text_size(11).child(text)))
			.children((b.parked ?? []).length ? [div().text_color(t.dim).text_size(11).child(`Parked: ${b.parked.length}`)] : []);
	}

	stageButtons(t, item) {
		return h_flex().gap(4).children(STAGES.map((stage) => div().id(`stage-${item.key}-${stage}`).px(6).h(20).flex().items_center().rounded(5).text_size(10).cursor_pointer()
			.when(item.stage === stage, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
			.on_click(() => this.doBoard(["stage", item.key, stage], `${item.key} is at ${stage}`)).child(stage)));
	}

	boardButtons(t, item) {
		const btn = (id, label, fn) => div().id(id).px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.accent).cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(fn).child(label);
		return h_flex().gap(6).children([
			btn(`switch-${item.key}`, "Switch", () => this.doBoard(["switch", item.key], `switched to ${item.key}`)),
			btn(`park-${item.key}`, "Park", () => this.doBoard(["park", item.key], `parked ${item.key}`)),
			btn(`drop-${item.key}`, "Drop", () => this.doBoard(["drop", item.key], `dropped ${item.key}`)),
			btn(`obsidian-${item.key}`, "Obsidian", () => exec("open", [L.openBoardArgv(`${home()}/repos/Obsidian/Focus.md`)[1]], { timeout: 10000 })),
		]);
	}

	async doBoard(args, label) {
		if (this.busy) return;
		this.busy = true;
		const r = await boardAction(home(), [FOCUS(home()), ...args], label);
		this.note = r.message;
		this.busy = false;
		await this.refreshBoard({ notify: () => {} });
	}

	// One repo: a header with a New button, then its worktrees.
	repoTree(t, name, data) {
		const repoPath = this.board.paths[name];
		const head = h_flex().h(24).gap(8).items_center()
			.child(div().flex_1().min_w(0).truncate().text_color(t.dim).text_size(11).child(name))
			.when(ENABLED.has("new"), (e) => e.child(div().id(`new-${name}`).px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.accent).cursor_pointer().on_click(() => this.naming = { repo: name, repoPath }).child("New")));
		if (data.error) return v_flex().gap(2).child(head).child(div().text_color(t.dim).text_size(11).child(data.error));
		const cleanable = ENABLED.has("cleanup") ? L.cleanupRows(data.rows, repoPath) : [];
		return v_flex().gap(2).child(head)
			.children(data.rows.map((row) => this.worktreeRow(t, row)))
			.when(cleanable.length > 0, (e) => e.child(this.cleanupBar(t, name, cleanable, repoPath)));
	}

	worktreeRow(t, row) {
		const label = row.branch ?? (row.detached ? "(detached)" : row.path);
		const parts = [row.jj ? "[jj]" : null, row.changes ? `${row.changes} changed` : null,
			row.ahead != null ? `↑${row.ahead} ↓${row.behind}` : null, MERGED_TAG[row.merged] ?? null,
			row.live ? "live" : null, row.prunable ? "prunable" : null].filter(Boolean).join("  ");
		const selected = this.selected === row.path;
		return h_flex().id(`wt-${row.path}`).h(26).px(6).gap(8).items_center().rounded(6)
			.when(selected, (e) => e.bg(t.selected)).hover((s) => s.bg(t.hover))
			.on_click(() => { this.selected = row.path; })
			.child(div().w(18).text_color(row.live ? t.ansi2 : t.dim).child(row.live ? "●" : "○"))
			.child(div().flex_1().min_w(0).truncate().child(label))
			.child(div().text_color(t.dim).text_size(11).truncate().child(parts))
			.when(ENABLED.has("open"), (e) => e
				.child(this.openButton(t, row, "Open", null))
				.child(this.openButton(t, row, "Claude", "claude"))
				.child(this.openButton(t, row, "Pi", "pi")));
	}

	// Open a worktree: terminal, its changes, and optionally a coding agent (claude or pi).
	openButton(t, row, label, agent) {
		return div().id(`open-${row.path}-${label}`).px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.accent).cursor_pointer()
			.hover((s) => s.text_color(t.foreground))
			.on_click(() => { this.note = openWorktree(home(), row, agent).message; })
			.child(label);
	}

	cleanupBar(t, name, rows, repoPath) {
		if (this.confirming === name) {
			return h_flex().h(28).gap(8).items_center()
				.child(div().flex_1().text_color(t.accent).text_size(11).child(`Remove ${rows.length} merged worktree${rows.length === 1 ? "" : "s"}? Branches are kept.`))
				.child(div().id(`cleanup-yes-${name}`).px(8).h(22).flex().items_center().rounded(5).bg(t.solid).text_color(t.solid_foreground).text_size(11).cursor_pointer().on_click(() => this.runCleanup(name, rows, repoPath)).child("Remove"))
				.child(div().id(`cleanup-no-${name}`).px(8).h(22).flex().items_center().rounded(5).text_size(11).cursor_pointer().on_click(() => { this.confirming = null; }).child("Keep"));
		}
		return h_flex().h(26).items_center().child(div().id(`cleanup-${name}`).px(6).h(22).flex().items_center().rounded(5).text_size(11).text_color(t.accent).cursor_pointer().on_click(() => { this.confirming = name; })
			.child(`Clean up ${rows.length} merged`));
	}

	async runCleanup(name, rows, repoPath) {
		this.confirming = null;
		this.busy = true;
		const results = await cleanupAll(home(), rows, repoPath);
		const refused = results.filter((r) => !r.ok);
		this.note = refused.length ? `${refused.length} refused: ${refused.map((r) => `${r.path.split("/").pop()} (${r.message})`).join("; ")}` : `Removed ${results.length}`;
		this.busy = false;
		await this.refresh({ notify: () => {} });
	}

	async runNew() {
		const n = this.naming;
		if (!n) return;
		this.busy = true;
		const r = await newWorktree(home(), n.repo, n.repoPath, this.branchName);
		this.note = r.message;
		this.busy = false;
		if (r.ok) { this.naming = null; this.branchName = ""; this.offer = r.offerSwitch; }
		await this.refresh({ notify: () => {} });
	}

	render() {
		const t = theme();
		if (!this.isPanel) return this.block(t);
		return v_flex().id("workspaces").size_full().min_h(0).p(12).gap(10).bg(t.background).text_color(t.foreground).text_size(13)
			.on_key_down((e) => this.key(e))
			.child(div().text_size(15).child("Workspaces"))
			.child(this.boardSection(t))
			.children(this.naming ? [this.namePrompt(t)] : [])
			.children(this.offer ? [this.offerSwitch(t)] : [])
			.children(this.note ? [div().text_color(t.dim).text_size(11).child(this.note)] : [])
			.children(Object.entries(this.repos).map(([name, data]) => this.repoTree(t, name, data)));
	}

	// Keyboard: up/down move the selection over worktree rows, Enter runs the row's primary action
	// (open), Escape closes the panel.
	key(e) {
		if (e.key === "escape") return closeOverlay(props().overlay);
		const rows = this.allRows(), i = rows.findIndex((r) => r.path === this.selected);
		if (e.key === "down" && rows.length) this.selected = rows[Math.min(rows.length - 1, i + 1)].path;
		if (e.key === "up" && rows.length) this.selected = rows[Math.max(0, i - 1)].path;
		if (e.key === "enter" && i >= 0 && L.primaryAction("worktree", ENABLED) === "open") this.note = openWorktree(home(), rows[i], null).message;
	}

	namePrompt(t) {
		return h_flex().h(30).gap(8).items_center()
			.child(div().text_color(t.dim).text_size(11).child(`New worktree in ${this.naming.repo}:`))
			.child(div().flex_1().min_w(0).h(24).px(6).flex().items_center().rounded(5).border_1().border_color(t.border).child(this.branchName || "branch name"))
			.child(div().id("new-create").px(8).h(22).flex().items_center().rounded(5).bg(t.solid).text_color(t.solid_foreground).text_size(11).cursor_pointer().on_click(() => this.runNew()).child("Create"))
			.child(div().id("new-cancel").px(8).h(22).flex().items_center().rounded(5).text_size(11).cursor_pointer().on_click(() => { this.naming = null; this.note = null; }).child("Cancel"));
	}

	offerSwitch(t) {
		const { repo, branch } = this.offer;
		return h_flex().h(30).gap(8).items_center()
			.child(div().flex_1().text_color(t.dim).text_size(11).child(`Switch focus to ${repo}:${branch}?`))
			.child(div().id("offer-yes").px(8).h(22).flex().items_center().rounded(5).bg(t.solid).text_color(t.solid_foreground).text_size(11).cursor_pointer()
				.on_click(() => { this.offer = null; this.doBoard(["switch", `${repo}:${branch}`], `focus is ${repo}:${branch}`); }).child("Switch"))
			.child(div().id("offer-no").px(8).h(22).flex().items_center().rounded(5).text_size(11).cursor_pointer().on_click(() => { this.offer = null; }).child("Later"));
	}
}
