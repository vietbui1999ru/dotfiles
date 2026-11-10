// Pure logic for the band's attention chips: no herdr or gpui imports, so the tests can load it.
// Ports of session-band's send-it.ts (sendItOn) and lifecycle.ts (queueBadge), read from the
// same sources the band already polls.

// The ctx percentage's colour level: 70+ blocked, 40+ working, else muted. Null when unknown.
export function ctxLevel(pct) {
  if (typeof pct !== "number" || Number.isNaN(pct)) return null;
  if (pct >= 70) return "blocked";
  if (pct >= 40) return "working";
  return "muted";
}

// send-it is on only when the repo's settings.local.json has both keys. Bad JSON is off.
export function sendItOn(text) {
  if (typeof text !== "string" || text === "") return false;
  let settings;
  try {
    settings = JSON.parse(text);
  } catch {
    return false;
  }
  const env = field(settings?.env);
  const permissions = field(settings?.permissions);
  return env.SEND_IT === "1" && permissions.defaultMode === "dontAsk";
}

function field(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

// Pueue's task status is a string ("Queued") or a one-key object ({ Done: {...} }).
function statusName(status) {
  if (typeof status === "string") return status;
  if (status && typeof status === "object") return Object.keys(status)[0] ?? null;
  return null;
}

const LIVE = new Set(["Queued", "Running", "Paused"]);

// `pueue status --json` output, read for the Pi queue: "N" when the daemon is up, the group is
// paused or has zero workers, and N live tasks are waiting in it. Null otherwise.
export function queueHeld(code, stdout, group = "default") {
  if (code !== 0 || typeof stdout !== "string") return null;
  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    return null;
  }
  const own = data?.groups?.[group];
  const stopped = own?.status === "Paused" || own?.parallel_tasks === 0;
  if (!stopped) return null;
  const rows = data?.tasks && typeof data.tasks === "object" ? Object.values(data.tasks) : [];
  const live = rows.filter((task) => LIVE.has(statusName(task?.status))).length;
  return live > 0 ? live : null;
}

// Keeps the chips that fit in `width`. Each chip is { id, rank, text }; rank 1 drops first and
// unranked chips (no rank) never drop. A chip costs 7px per character plus 16px of padding; the
// band's `reserved` px (terminal strip, quotas) come off the top.
export function fitChips(chips, width, reserved = 0) {
  const cost = (chip) => chip.text.length * 7 + 16;
  const kept = [...chips];
  const total = () => kept.reduce((sum, chip) => sum + cost(chip), 0);
  const budget = () => width - reserved;
  for (const rank of [1, 2]) {
    for (let i = kept.length - 1; i >= 0 && total() > budget(); i--) {
      if (kept[i].rank === rank) kept.splice(i, 1);
    }
  }
  return kept;
}
