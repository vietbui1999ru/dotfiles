// Run: node --test scripts/pi-spawn.test.mjs
//
// pi-spawn calls pueue; a fake pueue on PATH records its argv and environment so the tests
// check the queued command without queueing anything.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SPAWN = join(dirname(fileURLToPath(import.meta.url)), "pi-spawn");

const PUEUE_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2), viewApp: process.env.PI_VIEW_APP, place: process.env.PI_VIEW_PLACE }) + "\\n");
process.stdout.write("42\\n");
`;

const ROUTING = "PI_DELEGATE_HIGH_MODEL=opencode-go/high:high\nPI_DELEGATE_MEDIUM_MODEL=opencode-go/mid:medium\nPI_DELEGATE_LOW_MODEL=opencode-go/low:low\n";

function sandbox({ routing = ROUTING } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pi-spawn-test-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const pueue = join(bin, "pueue");
	writeFileSync(pueue, PUEUE_STUB);
	chmodSync(pueue, 0o755);
	const routingFile = join(dir, "routing.env");
	writeFileSync(routingFile, routing);
	const task = join(dir, "Plan Final v2.md");
	writeFileSync(task, "do the thing with $(rm -rf /) and `echo hi`\n");
	const log = join(dir, "pueue.log");
	writeFileSync(log, "");
	return {
		dir,
		task,
		log,
		run: (args, env = {}) => spawnSync("zsh", [SPAWN, ...args], {
			encoding: "utf8",
			timeout: 20000,
			env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`, HOME: dir, PI_ROUTING_ENV: routingFile, STUB_LOG: log, ...env },
		}),
		queued: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
	};
}

test("a tier resolves to its model from routing.env", () => {
	const box = sandbox();
	const result = box.run(["--tier", "medium", "--task-file", box.task]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /model=opencode-go\/mid:medium/);
	assert.ok(box.queued()[0].argv.join(" ").includes("--model opencode-go/mid:medium"));
});

test("--tier with --model is refused", () => {
	const box = sandbox();
	const result = box.run(["--tier", "high", "--model", "x/y", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(box.queued().length, 0);
});

test("a missing tier and missing model is refused", () => {
	const box = sandbox();
	const result = box.run(["--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(box.queued().length, 0);
});

test("a tier absent from routing.env is refused", () => {
	const box = sandbox({ routing: "PI_DELEGATE_HIGH_MODEL=x/y\n" });
	const result = box.run(["--tier", "low", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /PI_DELEGATE_LOW_MODEL is not set/);
});

test("--on is refused with exit 2 until the machine mesh lands", () => {
	const box = sandbox();
	const result = box.run(["--on", "vps", "--tier", "high", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(result.stderr.trim(), "pi-spawn: --on arrives with the machine mesh (slice D)");
	assert.equal(box.queued().length, 0);
});

test("the queued command keeps the task text unexpanded", () => {
	const box = sandbox();
	box.run(["--tier", "high", "--task-file", box.task]);
	const command = box.queued()[0].argv.join(" ");
	assert.ok(command.includes("$(cat "), "the task is read inside the pueue task");
	assert.ok(!command.includes("rm -rf"), "the task text itself is not in the queued command");
});

test("the slug is at most 16 characters and reduces the file name to a-z0-9-", () => {
	const box = sandbox();
	box.run(["--tier", "high", "--task-file", box.task]);
	const label = box.queued()[0].argv[box.queued()[0].argv.indexOf("--label") + 1];
	assert.ok(label.length <= 16, label);
	assert.match(label, /^[a-z0-9-]+$/);
	assert.match(label, /-[0-9a-f]{4}$/);
});

test("PI_VIEW_APP=1 is set in the environment of the pueue add call", () => {
	const box = sandbox();
	box.run(["--tier", "high", "--task-file", box.task]);
	assert.equal(box.queued()[0].viewApp, "1");
});

test("a value flag with no value exits 2 instead of looping", () => {
	const box = sandbox();
	const result = spawnSync("zsh", [SPAWN, "--tier"], {
		encoding: "utf8",
		timeout: 5000,
		env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", HOME: box.dir },
	});
	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, /--tier needs a value/);
	assert.equal(box.queued().length, 0);
});
