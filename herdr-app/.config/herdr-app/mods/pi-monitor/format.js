// Pure formatting for the Pi monitor mod: elapsed time, token and cost figures, the
// capped output lines, and the first line of a thinking block. No imports from `herdr` or
// `gpui-*`, so Node can test it (scripts/pi-monitor-format.test.mjs).

// "<1m", "12m", "3h", "2d": the agents mod's duration format.
export function elapsed(ms) {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

// Tokens as "950", "12.4k", "2.2M".
export function tokens(n) {
  if (!n) return "0";
  if (n < 1000) return String(n);
  if (n < 1e6) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
}

// Dollars to four places below a cent, else two: "$0.0043", "$5.71".
export function cost(usd) {
  const n = Number(usd) || 0;
  return n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`;
}

// At most `limit` lines of a tool's output, then "… N more".
export function capLines(text, limit = 12) {
  const lines = String(text ?? "").split("\n");
  if (lines.length <= limit) return lines;
  return [...lines.slice(0, limit), `… ${lines.length - limit} more`];
}

// The first line of a thinking block, trimmed.
export function firstLine(text) {
  const line = String(text ?? "").split("\n").find((l) => l.trim().length > 0);
  return line ? line.trim() : "";
}

// A task's outcome as the word the card shows.
export const OUTCOME_WORD = {
  running: "Running",
  queued: "Queued",
  paused: "Paused",
  success: "Done",
  review: "Needs review",
  killed: "Killed",
  failed: "Failed",
};
