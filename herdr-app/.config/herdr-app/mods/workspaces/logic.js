// Pure logic for the Workspaces mod: parsing git output, deciding merged and live state, and
// choosing which rows each action may act on. No herdr or gpui imports, so it is tested by
// scripts/workspaces-logic.test.mjs. Every command returned here is an argv array, never a
// shell string.

export const ACTIONS = ["board", "open", "new", "cleanup"];

// Which actions the mod draws, from props.actions. Missing means all of them. An unknown name
// is ignored, so a typo in the layout turns one action off rather than breaking the panel.
export function enabledActions(list) {
	if (!Array.isArray(list)) return new Set(ACTIONS);
	return new Set(list.filter((a) => ACTIONS.includes(a)));
}

// `git worktree list --porcelain`: blocks separated by blank lines, one `worktree` line each.
export function parseWorktrees(text) {
	const rows = [];
	for (const block of String(text ?? "").split(/\n\s*\n/)) {
		const row = { path: null, branch: null, head: null, detached: false, bare: false, prunable: false };
		for (const line of block.split("\n")) {
			if (line.startsWith("worktree ")) row.path = line.slice(9);
			else if (line.startsWith("HEAD ")) row.head = line.slice(5);
			else if (line.startsWith("branch refs/heads/")) row.branch = line.slice(18);
			else if (line === "detached") row.detached = true;
			else if (line === "bare") row.bare = true;
			else if (line.startsWith("prunable")) row.prunable = true;
		}
		if (row.path && !row.bare) rows.push(row);
	}
	return rows;
}

// `git status --porcelain=v1 -z`: entries end in NUL. Renames are off in the caller, so each
// entry is one path. Returns the number of changed paths (untracked included).
export function countChanges(text) {
	return String(text ?? "").split("\0").filter((entry) => entry.length >= 3).length;
}

// `git rev-list --left-right --count @{u}...HEAD` prints "<behind>\t<ahead>". No upstream (the
// command fails, the caller passes null) reads as no tracking: behind and ahead are null.
export function parseAheadBehind(text) {
	if (text == null) return { behind: null, ahead: null };
	const [behind, ahead] = String(text).trim().split(/\s+/).map(Number);
	if (!Number.isFinite(behind) || !Number.isFinite(ahead)) return { behind: null, ahead: null };
	return { behind, ahead };
}

// Merged state, judged by GitHub (every PR here is squash-merged, so git cannot see it).
// `prMerged` is the headRefName list from `gh pr list --state merged`, or null when gh failed.
// On failure the fallback is `git branch --merged` (the `gitMerged` list), and when that is
// missing too the answer is "unknown", never "not merged".
export function mergedState(branch, { prMerged, gitMerged } = {}) {
	if (!branch) return "unknown";
	if (Array.isArray(prMerged)) return prMerged.includes(branch) ? "merged" : "not merged";
	if (Array.isArray(gitMerged)) return gitMerged.includes(branch) ? "merged" : "not merged";
	return "unknown";
}

// The `gh pr list --json headRefName` answer as a list of branch names. A bad payload is null
// (the fallback path), never an empty list that would read as "nothing merged".
export function parsePrMerged(text) {
	try {
		const list = JSON.parse(String(text));
		if (!Array.isArray(list)) return null;
		return list.map((pr) => pr?.headRefName).filter((name) => typeof name === "string");
	} catch {
		return null;
	}
}

// `git branch --merged <default> --format=%(refname:short)`: one branch per line.
export function parseGitMerged(text) {
	return String(text ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
}

// A path is inside a parent when it equals the parent or sits under it with a separator. A
// sibling sharing a text prefix (/x/foo vs /x/foobar) is not inside.
export function isInside(path, parent) {
	if (!path || !parent) return false;
	const p = trimSlash(path), q = trimSlash(parent);
	if (q === "/") return p.startsWith("/");
	return p === q || p.startsWith(q + "/");
}
const trimSlash = (s) => (s.length > 1 ? s.replace(/\/+$/, "") : s);

// `lsof -a -d cwd -c claude -c pi -c node -Fn` prints one field per line; a cwd line starts with
// `n`. Other lines (pid `p`, fd `f`, ...) are skipped. Duplicates drop, so the list is unique.
export function parseLsofCwds(text) {
	const cwds = new Set();
	for (const line of String(text ?? "").split("\n")) {
		if (line.startsWith("n") && line.length > 1) cwds.add(line.slice(1));
	}
	return [...cwds];
}

// A Herdr terminal runs an agent when its program is an agent (`program.agent`) or it reports an
// agent status. A plain shell reports `agent: "zsh"`, so the bare `agent` field is not used.
export function isAgentTerminal(t) {
	return !!(t?.program?.agent || t?.agent_status);
}

// A worktree is live when an agent terminal's cwd sits in it. A nested worktree (the main
// worktree contains .claude/worktrees/*) is also "inside" its parent, so a cwd counts for the
// deepest worktree that holds it only. `allPaths` is every worktree path of the repo.
export function liveState(worktreePath, terminalCwds, allPaths = [worktreePath]) {
	return (terminalCwds ?? []).some((cwd) => {
		if (!isInside(cwd, worktreePath)) return false;
		const deepest = allPaths.filter((p) => isInside(cwd, p)).sort((a, b) => trimSlash(b).length - trimSlash(a).length)[0];
		return deepest === undefined || trimSlash(deepest) === trimSlash(worktreePath);
	});
}

// The rows of one repo: the worktree rows enriched with status, merged and live state.
export function decorate(rows, { changes = {}, tracking = {}, merged = {}, cwds = [] } = {}) {
	return rows.map((row) => ({
		...row,
		jj: false,
		changes: changes[row.path] ?? 0,
		...(tracking[row.path] ?? { behind: null, ahead: null }),
		merged: mergedState(row.branch, merged),
		live: liveState(row.path, cwds, rows.map((r) => r.path)),
	}));
}

// Whether a row is a managed `jw` worktree (under <repo>/.claude/worktrees/).
export function isManaged(row, repoPath) {
	return isInside(row.path, `${trimSlash(repoPath)}/.claude/worktrees`) && row.path !== repoPath;
}

// Rows the cleanup action may remove: merged, managed by jw, not the main worktree, not live,
// and not prunable. Never the branch; never a force flag.
export function cleanupRows(rows, repoPath) {
	return rows.filter((row) => row.merged === "merged" && !row.live && !row.prunable && row.branch && isManaged(row, repoPath));
}

// The `jw rm` argv for one worktree: the name is the path's last segment (jw's own naming).
export function jwRemoveArgv(home, row) {
	return [`${home}/dotfiles/scripts/jw`, "rm", basename(row.path)];
}

// `jw new <branch>`, run in the repo's main worktree.
export function jwNewArgv(home, branch) {
	return [`${home}/dotfiles/scripts/jw`, "new", branch];
}

// `focus switch <repo>:<branch>`.
export function focusSwitchArgv(home, repo, branch) {
	return [`${home}/dotfiles/scripts/focus`, "switch", `${repo}:${branch}`];
}

export function focusStageArgv(home, key, stage) {
	return [`${home}/dotfiles/scripts/focus`, "stage", key, stage];
}

export function focusParkArgv(home, key) {
	return [`${home}/dotfiles/scripts/focus`, "park", key];
}

// `focus drop` without --yes: the board only, never the worktree from here.
export function focusDropArgv(home, key) {
	return [`${home}/dotfiles/scripts/focus`, "drop", key];
}

// The board file opened in Obsidian: open obsidian://open?path=<encoded board path>.
export function openBoardArgv(boardPath) {
	const url = "obsidian://open?path=" + encodeURIComponent(boardPath);
	return ["open", url];
}

// The coding agents a new tab can start, by name.
export const AGENT_COMMANDS = { claude: ["claude"], pi: ["pi"] };

// A repo header's "new" needs a usable branch name: no whitespace, no leading dash, no `..`,
// no control characters, and it must not be empty. This is a guard, not git's full rule set.
export function validBranch(name) {
	const s = String(name ?? "").trim();
	if (!s || s.startsWith("-") || s.includes("..")) return null;
	const bad = " \t\n~^:?*[\\";
	for (const ch of s) if (bad.includes(ch) || ch.charCodeAt(0) < 32) return null;
	return s;
}

function basename(path) {
	const parts = trimSlash(String(path)).split("/");
	return parts[parts.length - 1];
}

// The primary action a row runs on Enter: a board row switches, a worktree opens.
export function primaryAction(kind, enabled) {
	if (kind === "board") return enabled.has("board") ? "board" : null;
	if (kind === "worktree") return enabled.has("open") ? "open" : null;
	if (kind === "repo") return enabled.has("new") ? "new" : null;
	return null;
}

// The attention line for the sidebar block: breaches first, then the merged count.
export function attentionText(breaches, mergedCount) {
	const parts = [];
	if (breaches?.length) parts.push(`${breaches.length} over cap`);
	if (mergedCount > 0) parts.push(`${mergedCount} merged to clean up`);
	return parts.join(" · ");
}

// --------------------------------------------------------------- error reports

// The text of a copyable error report (Markdown), for pasting into an agent session. The same
// function is copied into the pi-fleet and pi-changes logic.js files (mods import nothing from
// outside their folder); scripts/herdr-error-report.test.mjs fails if the copies drift apart.
// Every field is optional except mod and action; a missing one is left out, never printed as
// "undefined". Output fields are cut at REPORT_LIMIT characters with a note.
export const REPORT_LIMIT = 4000;

export function errorReport(fields = {}) {
	const { mod, action, target, argv, cwd, code, stdout, stderr, context, hint, time } = fields;
	const out = [`# ${mod}: ${action} failed`, ""];
	const line = (label, value) => { if (value !== undefined && value !== null && value !== "") out.push(`${label}: ${value}`); };
	line("When", time ?? new Date().toString());
	line("Target", target);
	line("Working folder", cwd);
	if (Array.isArray(argv) && argv.length) out.push(`Command: \`${shellLine(argv)}\``);
	line("Exit code", code);
	for (const [label, text] of [["stdout", stdout], ["stderr", stderr]]) {
		if (text === undefined || text === null || text === "") continue;
		const { body, cut } = clip(String(text));
		out.push("", `${label}:`, "```", body, "```");
		if (cut) out.push(`(${label} truncated to ${REPORT_LIMIT} characters)`);
	}
	if (context) out.push("", "Context:", "```", clip(String(context)).body, "```");
	if (hint) out.push("", `Next step: ${hint}`);
	out.push("", "Paste this into an agent session to investigate.");
	return out.join("\n") + "\n";
}

// The argv as a line a shell would accept: each word quoted unless it is plainly safe, so the
// command can be re-run as written.
export function shellLine(argv) {
	return argv.map((word) => {
		const s = String(word);
		return /^[A-Za-z0-9_\/.,:=+@%-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
	}).join(" ");
}

function clip(text) {
	if (text.length <= REPORT_LIMIT) return { body: text.replace(/\s+$/, ""), cut: false };
	return { body: text.slice(0, REPORT_LIMIT), cut: true };
}
