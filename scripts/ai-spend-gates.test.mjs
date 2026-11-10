// Tests for the gate-event toasts (herdr-app mods/ai-spend/gates.js).
// Run: node --test scripts/ai-spend-gates.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { gateToast, newEvents } from "../herdr-app/.config/herdr-app/mods/ai-spend/gates.js";

const event = (over = {}) => ({ ts: 1762790400000, gate: "agent-review", action: "approve", outcome: "ok", target: "pi-live-a3f9", message: null, ...over });

test("gateToast: approve ok maps to Approved or Spec approved", () => {
  assert.deepEqual(gateToast(event()), { title: "Approved", body: "pi-live-a3f9", level: "success", timeout: 5000 });
  assert.deepEqual(gateToast(event({ gate: "spec", target: "/r/SPEC.md" })), { title: "Spec approved", body: "/r/SPEC.md", level: "success", timeout: 5000 });
});

test("gateToast: cancelled maps to Approval cancelled", () => {
  assert.deepEqual(gateToast(event({ outcome: "cancelled" })), { title: "Approval cancelled", body: "pi-live-a3f9", level: "warning", timeout: 5000 });
});

test("gateToast: refused uses the message, else falls back to target", () => {
  assert.deepEqual(gateToast(event({ outcome: "refused", message: "tamper check failed" })), { title: "agent-review refused", body: "tamper check failed", level: "error", timeout: 10000 });
  assert.deepEqual(gateToast(event({ outcome: "refused", message: null })), { title: "agent-review refused", body: "pi-live-a3f9", level: "error", timeout: 10000 });
  assert.deepEqual(gateToast(event({ gate: "spec", outcome: "refused" })), { title: "Spec refused", body: "pi-live-a3f9", level: "error", timeout: 10000 });
});

test("gateToast: skip and deny ok map to Skipped and Spec denied", () => {
  assert.deepEqual(gateToast(event({ action: "skip" })), { title: "Skipped", body: "pi-live-a3f9", level: "info", timeout: 5000 });
  assert.deepEqual(gateToast(event({ gate: "spec", action: "deny" })), { title: "Spec denied", body: "pi-live-a3f9", level: "info", timeout: 5000 });
});

test("gateToast: malformed events are null", () => {
  assert.equal(gateToast(null), null);
  assert.equal(gateToast(event({ outcome: "done" })), null);
  assert.equal(gateToast(event({ gate: "other" })), null);
  assert.equal(gateToast(event({ action: "close" })), null);
  assert.equal(gateToast(event({ target: null })), null);
  assert.equal(gateToast(event({ target: 42 })), null);
  assert.equal(gateToast(event({ ts: "1762790400000" })), null);
});

test("newEvents: skips bad and blank lines, keeps file order, and only ts > sinceTs", () => {
  const text = [
    JSON.stringify(event({ ts: 100, target: "first" })),
    "{ not json",
    "",
    JSON.stringify(event({ ts: 200, target: "second" })),
    JSON.stringify(event({ ts: 200, target: "same-ts" })),
    JSON.stringify(event({ ts: 300, target: "third" })),
  ].join("\n");
  const events = newEvents(text, 100);
  assert.deepEqual(events.map((e) => e.target), ["second", "same-ts", "third"]);
  assert.deepEqual(newEvents(text, 300), []);
  assert.deepEqual(newEvents("", 0), []);
  assert.deepEqual(newEvents(null, 0), []);
});
