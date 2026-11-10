// Run: node --test scripts/pi-ai-spend-format.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { bandModel, costLabel, quotaLabel, quotaView, resetText, terminalSegments, TERMINAL_MAX_AGE_MS } from "../herdr-app/.config/herdr-app/mods/ai-spend/format.js";

test("costLabel: computed is approximate, reported is exact, null and missing are unknown", () => {
  assert.equal(costLabel({ cost_usd: 28.6667, cost_source: "computed" }), "≈$28.67");
  assert.equal(costLabel({ cost_usd: 1.1, cost_source: "reported" }), "$1.10");
  assert.equal(costLabel({ cost_usd: null, cost_source: "computed" }), "$—");
  assert.equal(costLabel(undefined), "$—");
});

test("quotaLabel: maps the four window names and nothing else", () => {
  assert.equal(quotaLabel("five_hour"), "5h");
  assert.equal(quotaLabel("primary"), "5h");
  assert.equal(quotaLabel("seven_day"), "7d");
  assert.equal(quotaLabel("secondary"), "7d");
  assert.equal(quotaLabel("monthly"), null);
});

test("quotaView: level thresholds at 59, 60, 79 and 80", () => {
  const at = (pct) => quotaView({ window: "five_hour", used_pct: pct, stale: false, expired: false });
  assert.deepEqual(at(59), { label: "5h", text: "59%", level: "normal", dim: false });
  assert.equal(at(60).level, "attention");
  assert.equal(at(79).level, "attention");
  assert.equal(at(80).level, "error");
  assert.equal(at(80).text, "80%");
});

test("quotaView: stale adds a question mark and dims", () => {
  assert.deepEqual(
    quotaView({ window: "seven_day", used_pct: 13, stale: true, expired: false }),
    { label: "7d", text: "13%?", level: "normal", dim: true },
  );
});

test("quotaView: expired shows a dash and dims", () => {
  assert.deepEqual(
    quotaView({ window: "primary", used_pct: 13, stale: false, expired: true }),
    { label: "5h", text: "—", level: "normal", dim: true },
  );
});

test("quotaView: expired takes priority over stale", () => {
  assert.deepEqual(
    quotaView({ window: "primary", used_pct: 90, stale: true, expired: true }),
    { label: "5h", text: "—", level: "normal", dim: true },
  );
});

test("quotaView: null used_pct shows a dash", () => {
  assert.deepEqual(
    quotaView({ window: "five_hour", used_pct: null, stale: false, expired: false }),
    { label: "5h", text: "—", level: "normal", dim: true },
  );
});

test("resetText: hours and minutes under a day", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const q = { window: "five_hour", resets_at: "2026-11-09T13:59:00Z", expired: false };
  assert.equal(resetText(q, now), "5h resets in 3h 59m");
});

test("resetText: days and hours from 24 hours up", () => {
  const now = Date.parse("2026-11-09T10:00:00Z");
  const q = { window: "seven_day", resets_at: "2026-11-11T14:00:00Z", expired: false };
  assert.equal(resetText(q, now), "7d resets in 2d 4h");
});

test("resetText: expired quota says so", () => {
  const q = { window: "secondary", resets_at: "2026-11-03T09:33:53Z", expired: true };
  assert.equal(resetText(q, Date.parse("2026-11-09T10:00:00Z")), "7d expired");
});

test("bandModel: non-zero exit is unavailable", () => {
  assert.deepEqual(bandModel(1, "{}"), { message: "Usage unavailable" });
});

test("bandModel: invalid JSON is unavailable", () => {
  assert.deepEqual(bandModel(0, "not json"), { message: "Usage unavailable" });
});

test("bandModel: unknown version is a format change", () => {
  assert.deepEqual(bandModel(0, JSON.stringify({ v: 2, subscriptions: {} })), { message: "Usage format changed" });
});

test("bandModel: missing subscriptions is unavailable", () => {
  assert.deepEqual(bandModel(0, JSON.stringify({ v: 1 })), { message: "Usage unavailable" });
});

test("bandModel: groups follow Claude, ChatGPT, Go, Other; 5h before 7d", () => {
  const sub = (cost) => ({ last_7d: { cost_usd: cost, cost_source: "computed" }, today: { cost_usd: 1, cost_source: "reported" } });
  const data = {
    v: 1,
    subscriptions: {
      other: { ...sub(0), quota: [] },
      "opencode-go": { ...sub(3), quota: [] },
      chatgpt: { ...sub(2), quota: [{ window: "secondary", used_pct: 5, stale: false, expired: false, resets_at: "2026-11-11T00:00:00Z" }, { window: "primary", used_pct: 7, stale: false, expired: false, resets_at: "2026-11-09T12:00:00Z" }] },
      claude: { ...sub(28.6667), quota: [] },
    },
  };
  const { groups } = bandModel(0, JSON.stringify(data));
  assert.deepEqual(groups.map((g) => g.name), ["Claude", "ChatGPT", "Go"]);
  assert.deepEqual(groups[1].quotas.map((q) => q.label), ["5h", "7d"]);
  assert.equal(groups[0].week, "≈$28.67");
  assert.equal(groups[0].today, "$1.00");
});

test("bandModel: a subscription with no quota is shown when it has a cost", () => {
  const data = {
    v: 1,
    subscriptions: {
      "opencode-go": { last_7d: { cost_usd: 0.5, cost_source: "reported" }, today: { cost_usd: null, cost_source: "reported" }, quota: [] },
    },
  };
  const { groups } = bandModel(0, JSON.stringify(data));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, "Go");
  assert.equal(groups[0].quotas.length, 0);
  assert.equal(groups[0].today, "$—");
});

// The focused terminal's snapshot, written by the status line per terminal. Hidden when the focus
// is not a Claude terminal, the file is missing or stale, or it is malformed.
const NOW = Date.parse("2026-11-09T12:00:00Z");
const snap = (over = {}) => JSON.stringify({ ctx: 70, model: "opus-4", branch: "feat/x", updated: NOW / 1000, ...over });

test("terminalSegments: a fresh snapshot gives ctx, model and branch", () => {
  assert.deepEqual(terminalSegments("t1r", snap(), NOW), { ctx: "ctx 70%", model: "opus-4", branch: "feat/x", ctxPct: 70 });
});

test("terminalSegments: no focused terminal, or an id that is not a plain name, shows nothing", () => {
  assert.equal(terminalSegments(null, snap(), NOW), null);
  assert.equal(terminalSegments("", snap(), NOW), null);
  assert.equal(terminalSegments("../evil", snap(), NOW), null);
  assert.equal(terminalSegments("a/b", snap(), NOW), null);
});

test("terminalSegments: a missing or unreadable file shows nothing", () => {
  assert.equal(terminalSegments("t1r", null, NOW), null);
  assert.equal(terminalSegments("t1r", "", NOW), null);
  assert.equal(terminalSegments("t1r", "{not json", NOW), null);
  assert.equal(terminalSegments("t1r", JSON.stringify({ ctx: 5 }), NOW), null);
});

test("terminalSegments: a snapshot older than five minutes is hidden, a fresh one is shown", () => {
  const stale = NOW / 1000 - TERMINAL_MAX_AGE_MS / 1000 - 1;
  assert.equal(terminalSegments("t1r", snap({ updated: stale }), NOW), null);
  const fresh = NOW / 1000 - TERMINAL_MAX_AGE_MS / 1000 + 5;
  assert.notEqual(terminalSegments("t1r", snap({ updated: fresh }), NOW), null);
});

test("terminalSegments: a snapshot with no context keeps its model and branch", () => {
  const got = terminalSegments("t1r", snap({ ctx: null, model: "", branch: "main" }), NOW);
  assert.equal(got.ctx, null);
  assert.equal(got.model, null);
  assert.equal(got.branch, "main");
});
