// Tests for the band's safety-block and mistake-alert counts (herdr-app mods/ai-spend/chips.js).
// Run: node --test scripts/ai-spend-safety.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { openAlerts, pendingBlocks, WINDOW_MS } from "../herdr-app/.config/herdr-app/mods/ai-spend/chips.js";

const NOW = Date.parse("2026-11-10T12:00:00+07:00");
const HOUR = 60 * 60 * 1000;
const block = (id, when) => JSON.stringify({ id, ts: new Date(when).toISOString(), rule: "cd", command: "cd x", reason: "r" });
const verdict = (id, v) => JSON.stringify({ id, verdict: v, ts: "2026-11-10T11:00:00+07:00" });

test("pendingBlocks: malformed and non-object lines are ignored", () => {
  const body = ["{ not json", "", "[1,2]", "null", "{\"ts\":\"x\"}", block("a", NOW - HOUR)].join("\n");
  assert.equal(pendingBlocks([body], "", NOW), 1);
  assert.equal(pendingBlocks([undefined, null], undefined, NOW), 0);
});

test("pendingBlocks: a judged block is not pending, and the last verdict wins", () => {
  const blocks = [block("a", NOW - HOUR), block("b", NOW - HOUR), block("c", NOW - HOUR)].join("\n");
  const verdicts = [verdict("a", "ok"), verdict("b", "noted"), verdict("b", "false-positive"), verdict("c", "bogus")].join("\n");
  // a is judged; b's last verdict is judged too; c's verdict is not a known value, so it stays pending.
  assert.equal(pendingBlocks([blocks], verdicts, NOW), 1);
});

test("pendingBlocks: blocks older than the window are excluded", () => {
  const blocks = [block("old", NOW - WINDOW_MS - HOUR), block("new", NOW - HOUR)].join("\n");
  assert.equal(pendingBlocks([blocks], "", NOW), 1);
  assert.equal(pendingBlocks([blocks], "", NOW, 0.5 * HOUR), 0);
});

test("pendingBlocks: a block in the rotated log and the current log counts once", () => {
  const rotated = block("dup", NOW - HOUR);
  const current = [block("dup", NOW - HOUR), block("fresh", NOW - HOUR)].join("\n");
  assert.equal(pendingBlocks([rotated, current], "", NOW), 2);
});

const alert = (fingerprint, at, status = "open") => ({ fingerprint, at, status, sessionId: "s", cwd: "/r" });
const alertsText = (alerts) => JSON.stringify({ alerts });

test("openAlerts: only open alerts inside the window count", () => {
  const text = alertsText([
    alert("old", NOW - WINDOW_MS - HOUR),
    alert("recorded", NOW - HOUR, "recorded"),
    alert("dismissed", NOW - HOUR, "dismissed"),
    alert("kept", NOW - HOUR),
  ]);
  assert.deepEqual(openAlerts(text, NOW).map((a) => a.fingerprint), ["kept"]);
});

test("openAlerts: newest first, bad JSON and missing alerts read as none", () => {
  const text = alertsText([alert("first", NOW - 2 * HOUR), alert("second", NOW - HOUR)]);
  assert.deepEqual(openAlerts(text, NOW).map((a) => a.fingerprint), ["second", "first"]);
  assert.deepEqual(openAlerts("{ nope", NOW), []);
  assert.deepEqual(openAlerts("{}", NOW), []);
  assert.deepEqual(openAlerts(undefined, NOW), []);
});
