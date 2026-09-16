import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAutoReview } from "./review-auto-policy.ts";

test("permits a small ordinary source batch to proceed to verification", () => {
	assert.deepEqual(
		evaluateAutoReview([
			{ path: "src/widget.ts", action: "modify", changedLoc: 32 },
			{ path: "test/widget.test.ts", action: "modify", changedLoc: 18 },
		]),
		{ eligible: true, reasons: [] },
	);
});

test("blocks protected paths and lockfiles", () => {
	const decision = evaluateAutoReview([
		{ path: ".github/workflows/ci.yml", action: "modify", changedLoc: 4 },
		{ path: "package-lock.json", action: "modify", changedLoc: 8 },
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /protected path/);
	assert.match(decision.reasons.join("\n"), /dependency lockfile/);
});

test("blocks a batch that exceeds conservative LOC limits", () => {
	const decision = evaluateAutoReview([
		{ path: "src/large.ts", action: "modify", changedLoc: 101 },
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /limit 100/);
});
