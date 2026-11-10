// Gate events turned into toasts. Pure: no `herdr` imports, so node can test it.
// scripts/agent-review and scripts/spec append one JSON line per decision to
// ~/.local/state/herdr-mods/gate-events.jsonl; see docs/workflows/agent-review.md.

const GATES = new Set(["agent-review", "spec"]);
const ACTIONS = new Set(["approve", "skip", "deny"]);
const OUTCOMES = new Set(["ok", "cancelled", "refused"]);

// One parsed gate event -> notify args, or null when the event is not one we show.
export function gateToast(event) {
  if (!event || typeof event !== "object") return null;
  if (typeof event.ts !== "number") return null;
  if (typeof event.target !== "string") return null;
  if (!GATES.has(event.gate) || !ACTIONS.has(event.action) || !OUTCOMES.has(event.outcome)) return null;
  const { gate, action, outcome, target, message } = event;
  if (action === "skip" || action === "deny") {
    if (outcome !== "ok") return null;
    return { title: action === "skip" ? "Skipped" : "Spec denied", body: target, level: "info", timeout: 5000 };
  }
  if (outcome === "ok") return { title: gate === "spec" ? "Spec approved" : "Approved", body: target, level: "success", timeout: 5000 };
  if (outcome === "cancelled") return { title: "Approval cancelled", body: target, level: "warning", timeout: 5000 };
  return {
    title: gate === "spec" ? "Spec refused" : "agent-review refused",
    body: typeof message === "string" ? message : target,
    level: "error",
    timeout: 10000,
  };
}

// The events in the file text newer than sinceTs, in file order. Bad lines are skipped.
export function newEvents(text, sinceTs) {
  if (typeof text !== "string") return [];
  const out = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event && typeof event.ts === "number" && event.ts > sinceTs) out.push(event);
  }
  return out;
}
