import assert from "node:assert/strict";
import test from "node:test";
import {
	ReviewGateSuspensionController,
	SyncControlRequest,
	controlFailure,
} from "./review-gate-suspension.ts";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("first synchronous request claim is permanent after throw or Promise", () => {
	const thrown = new SyncControlRequest({}, controlFailure);
	assert.equal(thrown.tryHandle(() => { throw new Error("boom"); }), true);
	assert.equal(thrown.tryHandle(() => ({ ok: true, enabled: true })), false);
	assert.deepEqual(thrown.result, { ok: false, error: "boom" });

	const promised = new SyncControlRequest({}, controlFailure);
	assert.equal(promised.tryHandle((() => Promise.resolve({ ok: true })) as any), true);
	assert.equal(promised.tryHandle(() => ({ ok: true, enabled: true })), false);
	assert.deepEqual(promised.result, { ok: false, error: "Review-gate control handlers must be synchronous" });
});

test("suspension restores the exact previous gate state", () => {
	for (const wasEnabled of [true, false]) {
		let enabled = wasEnabled;
		const controller = new ReviewGateSuspensionController((value) => { enabled = value; });
		const suspended = controller.suspend(wasEnabled, 1_000, 200);
		assert.equal(suspended.ok, true);
		enabled = false;
		const token = suspended.ok ? suspended.token : "";
		const restored = controller.restore(token, false);
		assert.equal(restored.ok, true);
		assert.equal(enabled, wasEnabled);
		assert.equal(controller.isActive(), false);
	}
});

test("publication deadline aborts but does not restore until quiescent end", async () => {
	let enabled = true;
	const controller = new ReviewGateSuspensionController((value) => { enabled = value; });
	const suspended = controller.suspend(true, 1_000, 100);
	assert.equal(suspended.ok, true);
	enabled = false;
	const token = suspended.ok ? suspended.token : "";
	const publication = controller.beginPublication(token);
	assert.equal(publication.ok, true);
	await wait(130);
	assert.equal(publication.ok && publication.signal.aborted, true);
	assert.equal(controller.isActive(), true);
	assert.equal(enabled, false);
	assert.equal(controller.restore(token, false).ok, false);
	const ended = controller.endPublication(token, false);
	assert.equal(ended.ok, false);
	assert.equal(controller.isActive(), false);
	assert.equal(enabled, true);
});

test("restore-only replacement capability survives expiry but never crosses boundary", () => {
	let now = 0;
	let enabled = true;
	const controller = new ReviewGateSuspensionController((value) => { enabled = value; }, () => now);
	const suspended = controller.suspend(true, 1_000, 200);
	assert.equal(suspended.ok, true);
	enabled = false;
	const token = suspended.ok ? suspended.token : "";
	assert.equal(controller.beginReplacement(token).ok, true);
	now = 5_000;
	assert.equal(controller.validate(token).ok, true);
	assert.equal(controller.restore(token, true).ok, false);
	assert.equal(enabled, false);
	assert.equal(controller.restore(token, false).ok, true);
	assert.equal(enabled, true);
});

test("invalid, duplicate, and competing suspension tokens fail closed", () => {
	const controller = new ReviewGateSuspensionController(() => undefined);
	const first = controller.suspend(true, 1_000, 200);
	assert.equal(first.ok, true);
	assert.equal(controller.suspend(true, 1_000, 200).ok, false);
	assert.equal(controller.restore("wrong", false).ok, false);
	const token = first.ok ? first.token : "";
	assert.equal(controller.restore(token, false).ok, true);
	assert.equal(controller.restore(token, false).ok, false);
});

test("shutdown discards suspension without restoring old state", () => {
	let restoreCalls = 0;
	const controller = new ReviewGateSuspensionController(() => { restoreCalls += 1; });
	const suspended = controller.suspend(true, 1_000, 200);
	assert.equal(suspended.ok, true);
	controller.shutdown();
	assert.equal(controller.isActive(), false);
	assert.equal(restoreCalls, 0);
});
