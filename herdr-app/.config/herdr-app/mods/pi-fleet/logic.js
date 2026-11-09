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
