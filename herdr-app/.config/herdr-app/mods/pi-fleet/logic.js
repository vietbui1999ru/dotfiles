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
