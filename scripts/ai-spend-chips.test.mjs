// Tests for the band's attention chips (herdr-app mods/ai-spend/chips.js).
// Run: node --test scripts/ai-spend-chips.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { ctxLevel, fitChips, queueHeld, sendItOn } from "../herdr-app/.config/herdr-app/mods/ai-spend/chips.js";

test("ctxLevel: colour thresholds at 39, 40, 69 and 70; unknown is null", () => {
  assert.equal(ctxLevel(39), "muted");
  assert.equal(ctxLevel(40), "working");
  assert.equal(ctxLevel(69), "working");
  assert.equal(ctxLevel(70), "blocked");
  assert.equal(ctxLevel(null), null);
  assert.equal(ctxLevel(undefined), null);
});

test("sendItOn: both keys on is on; one key, bad JSON and empty text are off", () => {
  const both = JSON.stringify({ env: { SEND_IT: "1" }, permissions: { defaultMode: "dontAsk" } });
  const envOnly = JSON.stringify({ env: { SEND_IT: "1" }, permissions: { defaultMode: "default" } });
  const modeOnly = JSON.stringify({ env: { SEND_IT: "0" }, permissions: { defaultMode: "dontAsk" } });
  assert.equal(sendItOn(both), true);
  assert.equal(sendItOn(envOnly), false);
  assert.equal(sendItOn(modeOnly), false);
  assert.equal(sendItOn("{ not json"), false);
  assert.equal(sendItOn(""), false);
  assert.equal(sendItOn(null), false);
});

// `pueue status --json` fixtures. Only the group and task shape matter here.
const task = (id, status) => ({ id, status, path: "/r", command: "c", label: null });
const pueue = (group, tasks) => JSON.stringify({ groups: { default: group }, tasks: Object.fromEntries(tasks.map((t) => [t.id, t])) });
const running = { status: "Running", parallel_tasks: 2 };
const paused = { status: "Paused", parallel_tasks: 2 };
const zero = { status: "Running", parallel_tasks: 0 };

test("queueHeld: daemon down is null", () => {
  assert.equal(queueHeld(1, ""), null);
  assert.equal(queueHeld(1, pueue(paused, [task(1, "Queued")])), null);
});

test("queueHeld: a running group is null even with queued work", () => {
  assert.equal(queueHeld(0, pueue(running, [task(1, "Queued"), task(2, "Running")])), null);
});

test("queueHeld: a paused group with two queued tasks holds 2", () => {
  assert.equal(queueHeld(0, pueue(paused, [task(1, "Queued"), task(2, "Queued")])), 2);
});

test("queueHeld: zero workers with one running task holds 1", () => {
  assert.equal(queueHeld(0, pueue(zero, [task(1, "Running")])), 1);
});

test("queueHeld: a paused group with only Done tasks is null", () => {
  assert.equal(queueHeld(0, pueue(paused, [task(1, { Done: { result: "Success" } })])), null);
});

test("queueHeld: object-form status counts as its key", () => {
  assert.equal(queueHeld(0, pueue(paused, [task(1, { Paused: {} }), task(2, { Done: {} })])), 1);
});

test("queueHeld: malformed stdout is null", () => {
  assert.equal(queueHeld(0, "nope"), null);
  assert.equal(queueHeld(0, undefined), null);
});

test("fitChips: everything fits, nothing drops", () => {
  const chips = [{ id: "a", rank: 1, text: "x" }, { id: "b", text: "y" }];
  assert.deepEqual(fitChips(chips, 1000, 0).map((c) => c.id), ["a", "b"]);
});

test("fitChips: drops rank 1 first, then rank 2, never an unranked chip", () => {
  const chips = [
    { id: "send", text: "⇉ send-it" },
    { id: "held", text: "π held 2" },
    { id: "r2", rank: 2, text: "⛔2" },
    { id: "r1", rank: 1, text: "⑂ 1·0" },
  ];
  const width = (ids) => chips.filter((c) => ids.includes(c.id)).reduce((s, c) => s + c.text.length * 7 + 16, 0);
  // Room for the unranked chips and rank 2 only: rank 1 goes first.
  const noRank1 = fitChips(chips, width(["send", "held", "r2"]), 0).map((c) => c.id);
  assert.deepEqual(noRank1, ["send", "held", "r2"]);
  // Room for the unranked chips only: rank 2 goes next, the unranked two stay.
  const onlyUnranked = fitChips(chips, width(["send", "held"]), 0).map((c) => c.id);
  assert.deepEqual(onlyUnranked, ["send", "held"]);
  // Even at zero width the unranked chips stay.
  assert.deepEqual(fitChips(chips, 0, 0).map((c) => c.id), ["send", "held"]);
});

test("fitChips: reserved px comes off the width before chips are kept", () => {
  const chips = [{ id: "a", text: "abcd" }];
  assert.equal(fitChips(chips, 100, 0).length, 1);
  assert.equal(fitChips(chips, 100, 100).length, 1, "unranked chips never drop");
  const ranked = [{ id: "a", rank: 1, text: "abcd" }];
  assert.equal(fitChips(ranked, 100, 100).length, 0);
});
