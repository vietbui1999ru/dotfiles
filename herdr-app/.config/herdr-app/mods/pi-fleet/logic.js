// Pure logic for the Pi fleet mod: which terminals are Pi runs, which windows to
// open, where each window sits, and what pi-spawn is asked to start. No imports from
// `herdr` or `gpui-*`, so Node can test it (scripts/pi-fleet-logic.test.mjs).

// A terminal labelled pi.session is a Pi run. A terminal with a state other than live
// (as the shipped agents mod skips) is left out.
export function piRows(terminals) {
  const rows = [];
  for (const t of terminals ?? []) {
    const labels = t.labels ?? {};
    if (!labels["pi.session"]) continue;
    if (t.state && t.state !== "live") continue;
    const address = String(t.address);
    const slash = address.indexOf("/");
    rows.push({
      address,
      machine: slash === -1 ? "local" : address.slice(0, slash),
      name: String(t.name ?? "").replace(/^pueue-/, ""),
      model: modelFrom(t.argv ?? []),
      status: t.status ?? null,
      turn: t.turn,
      isWindow: labels["pi.window"] === "1",
      createdMs: t.created_ms,
    });
  }
  return rows.sort((a, b) => a.machine.localeCompare(b.machine) || a.address.localeCompare(b.address));
}

// The model name from `--model provider/id[:thinking]`, with the provider and any thinking
// level removed. "viewer" when argv has no --model (the view-only terminal).
export function modelFrom(argv) {
  const i = argv.indexOf("--model");
  if (i === -1 || i + 1 >= argv.length) return "viewer";
  const id = argv[i + 1].replace(/:[^:/]*$/, "");
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

// "12m", "3h", "2d": the agents mod's duration format.
export function duration(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// The openOverlay spec for one Pi window: the terminal under a 28px drag bar.
export function windowSpec(address, index) {
  const step = 24 * (index % 8);
  return {
    kind: "window",
    key: address,
    keep: true,
    width: 720,
    height: 440,
    at: { x: 340 + step, y: 80 + step },
    layout: {
      type: "column",
      children: [
        { type: "block", size: { px: 28 }, content: { mod: "pi-window-bar", props: { terminal: address } } },
        { type: "block", content: { terminal: address } },
      ],
    },
  };
}

// True when a Pi run has taken at least one turn and is idle or done: the sidebar's Close
// button shows only then, so a fresh or working Pi is never closed by mistake.
export function canClose(row) {
  return (row.turn ?? 0) >= 1 && (row.status === "idle" || row.status === "done");
}

// The address after `current`, wrapping. The first row when `current` is not listed.
export function nextAddress(rows, current) {
  if (!rows || rows.length === 0) return null;
  const i = rows.findIndex((r) => r.address === current);
  return rows[(i + 1) % rows.length].address;
}

// Which window rows to open now. A row already opened or dismissed stays closed. Addresses
// that have gone from the terminal list are dropped from both lists.
export function planSync({ rows, opened, dismissed }) {
  const live = new Set(rows.map((r) => r.address));
  const done = new Set([...(opened ?? []), ...(dismissed ?? [])]);
  const open = rows.filter((r) => r.isWindow && !done.has(r.address)).map((r) => r.address);
  return {
    open,
    opened: [...new Set(opened ?? [])].filter((a) => live.has(a)),
    dismissed: [...new Set(dismissed ?? [])].filter((a) => live.has(a)),
  };
}

// The task file name: the first three words of the text, then `-<stamp>.md`.
export function taskFileName(text, stamp) {
  const words = String(text ?? "")
    .toLowerCase()
    .split(/\s+/)
    .slice(0, 3)
    .map((w) => w.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  const stem = words.length ? words.join("-") : "task";
  return `${stem}-${stamp}.md`;
}

// The pi-spawn argument list. `--on` only for another machine.
export function spawnArgs({ tier, taskFile, folder, machine }) {
  const args = ["--tier", tier, "--task-file", taskFile, "--cwd", folder];
  if (machine && machine !== "local") args.push("--on", machine);
  return args;
}

// The Pi runs a person can still approve, oldest first, from `agent-review list --json`.
// An orphan has no worktree to act in; a landed, running or broken run has nothing to approve.
export function reviewRows(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && e.owner && !e.orphan && !e.processing && !e.error && !e.landed)
    .map((e) => ({
      runId: e.runId,
      owner: e.owner,
      name: e.name || e.branch || String(e.runId).slice(0, 8),
      branch: e.branch,
      startedAt: e.startedAt,
    }))
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

// What to show after an approve call: null when it went through. Anything other than
// an exit 0 with `ok: true` counts as not approved.
export function approveMessage(code, stdout) {
  let reply;
  try {
    reply = JSON.parse(stdout);
  } catch {
    return "Approve failed";
  }
  if (code === 0 && reply?.ok === true) return null;
  if (reply?.reason === "not-confirmed") return "Cancelled";
  return reply?.message || "Approve failed";
}

// The agent-review records the cleanup view offers to remove: landed runs and orphans
// (no worktree). Oldest first. Each row names the repo the removal runs from.
export function cleanupRows(entries) {
  if (!Array.isArray(entries)) return [];
  return entries
    .filter((e) => e && (e.landed || e.orphan) && !e.processing && (e.owner ?? e.repo))
    .map((e) => ({
      runId: e.runId,
      cwd: e.owner ?? e.repo,
      name: e.name || e.branch || String(e.runId).slice(0, 8),
      kind: e.orphan ? "orphan" : "landed",
      startedAt: e.startedAt,
    }))
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
}

// What to show after a skip call: null when it went through, else the refusal's message.
export function removeMessage(code, stdout) {
  let reply;
  try {
    reply = JSON.parse(stdout);
  } catch {
    return "Remove failed";
  }
  if (code === 0 && reply?.ok === true) return null;
  return reply?.message || "Remove failed";
}

// One list for every terminal agent. `agents` is agents() in Herdr's order; each Pi run
// (from piRows) that the agent list already holds is marked, not repeated, so a Pi terminal
// shows once with its status and place. A Pi run the agent list lacks (no status reported
// yet) is appended after them, so no run disappears. Returns { address, pi, agent } entries
// in list order: `agent` is the agents() entry or null, `pi` the piRows row or null.
export function mergeAgentRows(agents, piRowList) {
  const piByAddress = new Map((piRowList ?? []).map((r) => [r.address, r]));
  const seen = new Set();
  const out = [];
  for (const agent of agents ?? []) {
    seen.add(agent.address);
    out.push({ address: agent.address, pi: piByAddress.get(agent.address) ?? null, agent });
  }
  for (const r of piRowList ?? []) {
    if (!seen.has(r.address)) out.push({ address: r.address, pi: r, agent: null });
  }
  return out;
}

// The address order of a displayed list, for setAgentOrder. Duplicates drop out.
export function displayedOrder(entries) {
  return [...new Set((entries ?? []).map((e) => e.address))];
}

// Sub-agents of one parent, depth first: each child with the tree lines drawn in front of
// it ("│" runs down past a sibling, "├" or "└" ends at the child). Only live children count.
// `terminals` are the terminal records; a child names its parent by `parent`.
export function subTree(terminals, address, lead = []) {
  const kids = (terminals ?? []).filter((k) => k.parent === address && (!k.state || k.state === "live"));
  return kids.flatMap((k, i) => {
    const last = i === kids.length - 1;
    return [
      { t: k, lines: [...lead, last ? "└" : "├"] },
      ...subTree(terminals, k.address, [...lead, last ? "" : "│"]),
    ];
  });
}

// Pinned entries first, in their order, then the rest in theirs. Splits on `pinned`.
export function pinnedFirst(list) {
  const pinned = list.filter((a) => a.pinned);
  return [...pinned, ...list.filter((a) => !a.pinned)];
}

// Priority order: higher rank first, then the tie-break. `stamp` is when the row's state last
// changed (ms, 0 when not seen), so a larger stamp is a more recent change. The built-in list
// sorts the most recently changed first within a rank; an unseen row (stamp 0) comes last.
export function byUrgency(rankOf, stampOf) {
  return (x, y) => rankOf(y) - rankOf(x) || stampOf(y) - stampOf(x);
}

// The change map without addresses that are no longer listed, so it cannot grow forever.
export function pruneChanged(changed, listed) {
  const keep = new Set(listed ?? []);
  const out = {};
  for (const [address, entry] of Object.entries(changed ?? {})) {
    if (keep.has(address)) out[address] = entry;
  }
  return out;
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
