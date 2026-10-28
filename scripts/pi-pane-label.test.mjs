import assert from "node:assert/strict";
import { test } from "node:test";

import { paneLabel, sessionFlag, taskIdFor } from "./pi-pane-label.mjs";

const task = (id, command, status) => [String(id), { id, path: "/work", command, status }];
const running = { Running: { enqueued_at: "2026-10-28T04:00:00Z", start: "2026-10-28T04:00:01Z" } };
const done = { Done: { enqueued_at: "2026-10-28T04:00:00Z", start: "2026-10-28T04:00:01Z", end: "2026-10-28T04:10:00Z", result: "Success" } };
const statusJson = tasks => JSON.stringify({ tasks: Object.fromEntries(tasks) });

test("finds the Running task dispatched for the session", () => {
	const json = statusJson([
		task(7, "scripts/pi-view --tui pi --model m --session-id pueue-other -p x", running),
		task(8, "pi --model m --session-id pueue-mine -p x", done),
		task(9, "scripts/pi-view --tui pi --model m --session-id pueue-mine -p x", running),
	]);
	assert.equal(taskIdFor(json, "pueue-mine"), 9);
});

test("reads the session flag however the dispatch quoted it", () => {
	const json = statusJson([
		task(4, "pi --model 'm' --session-id 'pueue-quoted' -p x", running),
		task(5, "pi --model m --session-id=pueue-equals -p x", running),
	]);
	assert.equal(taskIdFor(json, "pueue-quoted"), 4);
	assert.equal(taskIdFor(json, "pueue-equals"), 5);
});

test("does not match a session id that is only a prefix of another", () => {
	const json = statusJson([task(3, "pi --model m --session-id pueue-mine-two -p x", running)]);
	assert.equal(taskIdFor(json, "pueue-mine"), undefined);
	assert.equal(sessionFlag("pueue-mine").test("--session-id pueue-mine-two"), false);
});

test("finds nothing without a Running task, and nothing in unparseable output", () => {
	assert.equal(taskIdFor(statusJson([task(8, "pi --model m --session-id pueue-mine -p x", done)]), "pueue-mine"), undefined);
	assert.equal(taskIdFor(statusJson([task(9, "pi --model m --session-id pueue-mine -p x", { Queued: {} })]), "pueue-mine"), undefined);
	assert.equal(taskIdFor("not json", "pueue-mine"), undefined);
});

test("labels the pane with the task id and the slug", () => {
	assert.equal(paneLabel(184, "pueue-pi-panes-958d"), "pi#184 pi-panes-958d");
	assert.equal(paneLabel(12, "adhoc"), "pi#12 adhoc");
});
