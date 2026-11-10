// The focus block (sidebar) and the Workspaces panel (overlay). The block shows the Work and
// Hobby slots and an attention line; a click opens the panel. The panel lists the focus board
// and, for each board repo, its worktrees and jj workspaces with actions. The board comes from
// `scripts/focus status --json`; git and gh data come from each repo's main worktree.
// Props: { role: "panel" } draws the panel; { actions: [...] } turns actions on (see logic.js).
// The view never fetches: `gh` runs at most every 5 minutes, and only its list is read.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, home, terminals, watchFolder, openOverlay, closeOverlay, props, run, nextCommand, theme, setShared, shared, readTextFile, writeTextFile, notify } from "herdr";
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
async function repoRows(repoPath, cwds, unavailable) {
	const wt = await exec("git", ["worktree", "list", "--porcelain"], { cwd: repoPath, timeout: 10000 }).catch(() => null);
	if (!wt || wt.code !== 0) return { rows: [], error: "git worktree list failed" };
	const rows = L.parseWorktrees(wt.stdout);
	const changes = {}, tracking = {};
	await Promise.all(rows.map((row) => readRowState(row, changes, tracking)));
	const gh = await prMerged(repoPath);
	const merged = gh ? { prMerged: gh, gitMerged: [] } : { prMerged: null, gitMerged: await gitMergedFallback(repoPath) };
	const decorated = L.decorate(rows, { changes, tracking, merged, cwds });
	for (const r of decorated) {
		r.jj = rows.find((x) => x.path === r.path)?.jj ?? false;
		if (unavailable) r.live = true; // unknown live state: never offered for cleanup
	}
	return { rows: decorated, error: null, liveUnavailable: unavailable };
}

// Live cwds: agent terminals in Herdr, plus the cwds of running claude/pi/node processes (background
// jobs and Pi runs started outside Herdr). `lsof` failing or missing means live state is unknown:
// the caller then treats every managed worktree as live rather than assuming it is not.
async function liveCwds() {
	const herdr = (terminals() ?? []).filter(L.isAgentTerminal).map((t) => t.cwd).filter(Boolean);
	const r = await exec("lsof", ["-a", "-d", "cwd", "-c", "claude", "-c", "pi", "-c", "node", "-Fn"], { timeout: 5000 }).catch(() => null);
	// lsof exits 1 when nothing matches: an empty list, not a failure. Anything else is unavailable.
	if (!r || (r.code !== 0 && r.code !== 1)) return { cwds: herdr, unavailable: true };
	return { cwds: [...herdr, ...L.parseLsofCwds(r.stdout)], unavailable: false };
}

// --------------------------------------------------------------- actions (each argv, no shell)

// Board actions: re-read the board after each one.
async function boardAction(h, argv, label) {
	const r = await exec(argv[0], argv.slice(1), { timeout: 20000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
	return { ok: r.code === 0, message: r.code === 0 ? label : (r.stderr || r.stdout || "failed").trim(), raw: { argv, cwd: null, code: r.code, stdout: r.stdout, stderr: r.stderr } };
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
	const argv = L.jwNewArgv(h, branch);
	const r = await exec(argv[0], argv.slice(1), { cwd: repoPath, timeout: 120000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
	if (r.code !== 0) return { ok: false, message: (r.stderr || r.stdout || "jw new failed").trim(), raw: { argv, cwd: repoPath, code: r.code, stdout: r.stdout, stderr: r.stderr } };
	return { ok: true, message: `created ${branch}`, offerSwitch: { repo, branch } };
}

// Cleanup: remove each merged, managed, not-live worktree with jw rm. Never a branch, never force.
async function cleanupAll(h, rowsToClean, repoPath) {
	const results = [];
	for (const row of rowsToClean) {
		const argv = L.jwRemoveArgv(h, row);
		const r = await exec(argv[0], argv.slice(1), { cwd: repoPath, timeout: 60000 }).catch((e) => ({ code: 1, stderr: String(e), stdout: "" }));
		results.push({ path: row.path, ok: r.code === 0, message: r.code === 0 ? "removed" : (r.stderr || r.stdout || "refused").trim(), raw: { argv, cwd: repoPath, code: r.code, stdout: r.stdout, stderr: r.stderr } });
	}
	return results;
}

// Copy an error report: write it to the reports folder and to last-error.md, put it on the
// clipboard through herdr-copy, and toast the path. A failed copy still leaves the file.
// `report` is errorReport(...) text; `mod` and `action` name it. Returns the saved path.
async function copyReport(report, mod, action) {
	const dir = L.reportDir(home());
	await exec("mkdir", ["-p", dir]);
	let path = `${dir}/${L.reportFileName(mod, action)}`;
	for (let n = 2; (await readTextFile(path)) !== null; n++) path = `${dir}/${L.reportFileName(mod, action).replace(/\.md$/, `-${n}.md`)}`;
	await writeTextFile(path, report, null);
	const last = L.lastErrorPath(home());
	await writeTextFile(last, report, await readTextFile(last));
	const copied = await exec(`${home()}/dotfiles/scripts/herdr-copy`, [path], { timeout: 10000 }).then((r) => r.code === 0).catch(() => false);
	notify({ title: copied ? "Error report copied" : "Error report saved", body: copied ? path : `Copy failed. The report is at ${path}`, level: copied ? "info" : "warning", timeout: 8000 });
	return path;
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
				if (c === "toggle") this.togglePanel();
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

	// Opens the panel and remembers its id, so the toggle can close it again.
	openPanel() {
		setShared("workspaces.panel", openOverlay({ mod: "workspaces", kind: "dialog", width: 640, props: { role: "panel", actions: props()?.actions } }));
	}

	// Closes the panel when it is open, else opens it. A remembered id the app no longer holds
	// (the panel closed some other way) is closed quietly and a new panel opens in its place.
	togglePanel() {
		const id = shared("workspaces.panel");
		setShared("workspaces.panel", null);
		if (id) {
			try { closeOverlay(id); return; } catch { /* stale: the panel is already gone */ }
		}
		this.openPanel();
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
			const { cwds, unavailable } = await liveCwds(), repos = {};
			for (const repo of this.board?.paths ? Object.keys(this.board.paths) : []) {
				repos[repo] = await repoRows(this.board.paths[repo], cwds, unavailable);
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
			btn(`obsidian-${item.key}`, "Obsidian", () => this.openBoardInObsidian()),
		]);
	}

	// The board path comes from `focus status --json`, so FOCUS_BOARD is honoured.
	openBoardInObsidian() {
		if (!this.board?.board) { this.setNote("No board path to open"); return; }
		const argv = L.openBoardArgv(this.board.board);
		exec(argv[0], argv.slice(1), { timeout: 10000 })
			.then((r) => { if (r.code !== 0) this.setNote((r.stderr || "open failed").trim(), { mod: "workspaces", action: "open board", target: this.board.board, raw: { argv, cwd: null, code: r.code, stdout: r.stdout, stderr: r.stderr } }); })
			.catch((e) => this.setNote(String(e), { mod: "workspaces", action: "open board", target: this.board.board, raw: { argv, cwd: null, code: 1, stdout: "", stderr: String(e) } }));
	}

	// The note line, and when the failure can be reported, the raw data the Copy button needs.
	// A plain note (no failure) clears any earlier one.
	setNote(message, failure = null) {
		this.note = message;
		this.failure = failure;
		this.refusals = null;
	}

	async doBoard(args, label) {
		if (this.busy) return;
		this.busy = true;
		const r = await boardAction(home(), [FOCUS(home()), ...args], label);
		this.setNote(r.message, r.ok ? null : { mod: "workspaces", action: `board ${args[0]}`, target: args.slice(1).join(" "), raw: r.raw, hint: "Fix the board or the named item, then try again." });
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
		const liveNote = data.liveUnavailable ? div().text_color(t.dim).text_size(11).child("live check unavailable") : null;
		const cleanable = ENABLED.has("cleanup") ? L.cleanupRows(data.rows, repoPath) : [];
		return v_flex().gap(2).child(head)
			.children(liveNote ? [liveNote] : [])
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
			.on_click(() => { this.setNote(openWorktree(home(), row, agent).message); })
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
		this.setNote(refused.length ? `${refused.length} refused: ${refused.map((r) => `${r.path.split("/").pop()} (${r.message})`).join("; ")}` : `Removed ${results.length}`);
		this.refusals = refused.length ? refused.map((r) => ({ path: r.path, message: r.message, raw: r.raw })) : null;
		this.busy = false;
		await this.refresh({ notify: () => {} });
	}

	// The report for one refused cleanup row: what jw said, plus git's view of the worktree at
	// report time (read-only), and what jw asked for.
	async cleanupReport(refusal) {
		const cwd = refusal.path;
		const status = await exec("git", ["status", "--short"], { cwd, timeout: 10000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
		const stash = await exec("git", ["stash", "list"], { cwd, timeout: 10000 }).catch((e) => ({ code: 1, stdout: "", stderr: String(e) }));
		const context = [`$ git status --short`, status.stdout || status.stderr || "(no output)", `$ git stash list`, stash.stdout || stash.stderr || "(no stashes)"].join("\n");
		return L.errorReport({
			mod: "workspaces", action: "cleanup", target: refusal.path, argv: refusal.raw?.argv, cwd: refusal.raw?.cwd, code: refusal.raw?.code,
			stdout: refusal.raw?.stdout, stderr: refusal.raw?.stderr ?? refusal.message, context,
			hint: "Commit, stash or remove the uncommitted or ignored files in this worktree, then clean up again.",
		});
	}

	async copyCleanupRow(refusal) {
		const text = await this.cleanupReport(refusal);
		await copyReport(text, "workspaces", "cleanup");
	}

	async copyCleanupAll() {
		const parts = [];
		for (const r of this.refusals ?? []) parts.push(await this.cleanupReport(r));
		if (parts.length) await copyReport(parts.join("\n---\n\n"), "workspaces", "cleanup-all");
	}

	// The Copy control for the current failure note (board, open board, new worktree).
	async copyFailure() {
		const f = this.failure;
		if (!f) return;
		const text = L.errorReport({ mod: f.mod, action: f.action, target: f.target, argv: f.raw?.argv, cwd: f.raw?.cwd, code: f.raw?.code, stdout: f.raw?.stdout, stderr: f.raw?.stderr ?? this.note, hint: f.hint });
		await copyReport(text, f.mod, f.action);
	}

	async runNew() {
		const n = this.naming;
		if (!n) return;
		this.busy = true;
		const r = await newWorktree(home(), n.repo, n.repoPath, this.branchName);
		this.setNote(r.message, r.ok ? null : { mod: "workspaces", action: "new worktree", target: `${n.repo}:${this.branchName}`, raw: r.raw, hint: "Fix the branch name or the repo, then try again." });
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
			.children(this.note ? [this.noteLine(t)] : [])
			.children(this.refusals?.length ? [this.refusalList(t)] : [])
			.children(Object.entries(this.repos).map(([name, data]) => this.repoTree(t, name, data)));
	}

	// Keyboard: up/down move the selection over worktree rows, Enter runs the row's primary action
	// (open), Escape closes the panel.
	key(e) {
		if (e.key === "escape") {
			setShared("workspaces.panel", null);
			return closeOverlay(props().overlay);
		}
		const rows = this.allRows(), i = rows.findIndex((r) => r.path === this.selected);
		if (e.key === "down" && rows.length) this.selected = rows[Math.min(rows.length - 1, i + 1)].path;
		if (e.key === "up" && rows.length) this.selected = rows[Math.max(0, i - 1)].path;
		if (e.key === "enter" && i >= 0 && L.primaryAction("worktree", ENABLED) === "open") this.setNote(openWorktree(home(), rows[i], null).message);
	}

	// A note line; a failure that can be reported gets a Copy control beside it.
	noteLine(t) {
		return h_flex().gap(8).items_center()
			.child(div().flex_1().min_w(0).text_color(t.dim).text_size(11).child(this.note))
			.when(!!this.failure, (e) => e.child(this.copyButton(t, "copy-note", () => this.copyFailure())));
	}

	// The refused cleanup rows: each with its own message and Copy, then one Copy for the batch.
	refusalList(t) {
		return v_flex().gap(4)
			.children(this.refusals.map((r) => h_flex().id(`refused-${r.path}`).gap(8).items_center()
				.child(div().w(120).flex_none().min_w(0).truncate().text_color(t.dim).text_size(11).child(r.path.split("/").pop()))
				.child(div().flex_1().min_w(0).text_color(t.accent).text_size(11).child(r.message))
				.child(this.copyButton(t, `copy-refused-${r.path}`, () => this.copyCleanupRow(r)))))
			.child(h_flex().justify_end().child(this.copyButton(t, "copy-refused-all", () => this.copyCleanupAll(), "Copy all")));
	}

	copyButton(t, id, onClick, label = "Copy") {
		return div().id(id).flex_none().px(6).h(20).flex().items_center().rounded(5).text_size(11).text_color(t.accent).cursor_pointer()
			.hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => { onClick().catch(() => {}); cx.notify(); }).child(label);
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
