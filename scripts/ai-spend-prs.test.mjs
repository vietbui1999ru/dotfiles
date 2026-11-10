// Tests for the band's PR chip (herdr-app mods/ai-spend/prs.js).
// Run: node --test scripts/ai-spend-prs.test.mjs
import assert from "node:assert/strict";
import { test } from "node:test";
import { PR_ARGV, prSummary } from "../herdr-app/.config/herdr-app/mods/ai-spend/prs.js";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-11-10T12:00:00Z");
const pass = [{ status: "COMPLETED", conclusion: "SUCCESS" }];
const fail = [{ status: "COMPLETED", conclusion: "FAILURE" }];
const pending = [{ status: "IN_PROGRESS", conclusion: "" }];
const pr = (number, extra = {}) => ({
  number,
  title: `feat(band): change ${number}`,
  headRefName: `feat/change-${number}`,
  url: `https://github.com/o/r/pull/${number}`,
  isDraft: false,
  state: "OPEN",
  mergedAt: null,
  updatedAt: new Date(NOW - HOUR).toISOString(),
  statusCheckRollup: pass,
  ...extra,
});
const list = (...prs) => JSON.stringify(prs);

test("PR_ARGV lists every state so merged and closed PRs can be filtered", () => {
  assert.deepEqual(PR_ARGV.slice(0, 3), ["pr", "list", "--state"]);
  assert.ok(PR_ARGV.join(" ").includes("statusCheckRollup"));
});

test("prSummary: counts open drafts and ready PRs", () => {
  const out = prSummary(list(pr(1, { isDraft: true }), pr(2), pr(3)));
  assert.equal(out.drafts, 1);
  assert.equal(out.ready, 2);
  assert.equal(out.failing, false);
  assert.equal(out.lines.length, 3);
});

test("prSummary: a failing check on any open PR sets failing", () => {
  const out = prSummary(list(pr(1), pr(2, { statusCheckRollup: fail })));
  assert.equal(out.failing, true);
});

test("prSummary: pending checks are not failing", () => {
  const out = prSummary(list(pr(1, { statusCheckRollup: pending })));
  assert.equal(out.failing, false);
});

test("prSummary: merged and closed PRs are not counted", () => {
  const merged = pr(1, { state: "MERGED", mergedAt: new Date(NOW - HOUR).toISOString(), statusCheckRollup: fail });
  const closed = pr(2, { state: "CLOSED", isDraft: true });
  const out = prSummary(list(merged, closed));
  assert.deepEqual([out.drafts, out.ready, out.failing, out.lines.length], [0, 0, false, 0]);
});

test("prSummary: non-JSON output is an error", () => {
  assert.ok(typeof prSummary("not json").error === "string");
});

test("prSummary: a JSON value that is not a list is an error", () => {
  assert.ok(typeof prSummary("{}").error === "string");
});

test("prSummary: lines are capped at six", () => {
  const many = Array.from({ length: 9 }, (_, i) => pr(i + 1));
  assert.equal(prSummary(list(...many)).lines.length, 6);
});

test("prSummary: a line carries the number and the title", () => {
  const [line] = prSummary(list(pr(42, { isDraft: true }))).lines;
  assert.match(line, /#42/);
  assert.match(line, /change 42/);
});
