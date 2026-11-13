// Pure logic for the Pi changes mod: whether a run is picked, the git refs a run's review
// lives under, and the arguments for its diff. No imports from `herdr` or `gpui-*`, so Node
// can test it (scripts/pi-changes-logic.test.mjs).

// A run id is the UUID agent-review writes into its refs and records. Checked before it becomes
// part of a ref name, so a hostile or malformed value never reaches git.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The picked run, or null for the working-tree view. A value that is not a complete run
// (missing fields, or a run id that is not a lowercase UUID) is treated as no run.
export function runFrom(value) {
  if (!value || typeof value !== "object") return null;
  const { runId, cwd, name } = value;
  if (typeof runId !== "string" || !RUN_ID.test(runId)) return null;
  if (typeof cwd !== "string" || cwd === "") return null;
  return { runId, cwd, name: typeof name === "string" && name !== "" ? name : runId.slice(0, 8) };
}

// The two refs a run's review diffs between. `base` is taken when the run starts, `end` when
// it finishes. Returns null when the run id is not a valid UUID.
export function refsFor(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) return null;
  return { base: `refs/agent-review/${runId}/base`, end: `refs/agent-review/${runId}/end` };
}

// The git arguments that list a run's changed files, or show one of them. Both use the same
// read-only switches as the working-tree view, so a read writes nothing under .git.
export const RUN_READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export function rangeArgs(refs, path) {
  const range = [refs.base, refs.end];
  if (path === undefined) return [...RUN_READ, "diff", ...range, "--numstat", "-z", "--no-renames"];
  return [...RUN_READ, "diff", ...range, "--no-ext-diff", "--no-textconv", "--no-color", "--", path];
}

// ------------------------------------------------------------ keyboard focus

// The file index a j/k press lands on: the current one moved by `delta`, clamped to the list.
// With no current file (nothing picked yet) the first press lands on the first file, and an
// empty list has no index (-1).
export function nextIndex(count, current, delta) {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (!Number.isInteger(current) || current < 0) return delta < 0 ? count - 1 : 0;
  return Math.min(count - 1, Math.max(0, current + delta));
}

// The diff row a ctrl-d / ctrl-u press scrolls to: half a page (`pageRows` rows) from `top`,
// clamped to [0, rows - 1]. An empty diff stays at 0.
export function halfPageTarget(rows, top, pageRows, direction) {
  if (!Number.isInteger(rows) || rows <= 0) return 0;
  const step = Math.max(1, Math.floor((Number.isInteger(pageRows) ? pageRows : 0) / 2));
  const from = Number.isInteger(top) ? top : 0;
  return Math.min(rows - 1, Math.max(0, from + (direction < 0 ? -step : step)));
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

// The folder reports are saved in, and the file the latest one is also written to.
export function reportDir(home) {
	return `${home}/.local/state/herdr-mods/reports`;
}
export function lastErrorPath(home) {
	return `${home}/.local/state/herdr-mods/last-error.md`;
}

// <YYYYMMDD-HHMMSS>-<mod>-<action>.md, from a Date (local time). Two reports in one second get
// the same name; the caller adds a suffix when a file already exists.
export function reportFileName(mod, action, date = new Date()) {
	const p = (n) => String(n).padStart(2, "0");
	const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
	const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "x";
	return `${stamp}-${slug(mod)}-${slug(action)}.md`;
}
