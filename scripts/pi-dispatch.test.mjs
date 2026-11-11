// Run: node --test scripts/pi-dispatch.test.mjs
//
// pi-dispatch calls pueue; a fake pueue on PATH records its argv and environment so the tests
// check the queued command without queueing anything.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SPAWN = join(dirname(fileURLToPath(import.meta.url)), "pi-dispatch");

const PUEUE_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify({ argv: process.argv.slice(2), viewApp: process.env.PI_VIEW_APP, place: process.env.PI_VIEW_PLACE }) + "\\n");
process.stdout.write("42\\n");
`;

const ROUTING = "PI_DELEGATE_HIGH_MODEL=opencode-go/high:high\nPI_DELEGATE_MEDIUM_MODEL=opencode-go/mid:medium\nPI_DELEGATE_LOW_MODEL=opencode-go/low:low\n";

const SETTINGS = JSON.stringify({ enabledModels: ["opencode-go/high", "opencode-go/mid", "opencode-go/low", "x/y"] });

// A real repo with a linked worktree at .claude/worktrees/wt on feat/wt: the only cwd shape add accepts.
function sandbox({ routing = ROUTING, settings = SETTINGS } = {}) {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-dispatch-test-")));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const pueue = join(bin, "pueue");
	writeFileSync(pueue, PUEUE_STUB);
	chmodSync(pueue, 0o755);
	const routingFile = join(dir, "routing.env");
	writeFileSync(routingFile, routing);
	const settingsFile = join(dir, "pi-settings.json");
	if (settings !== null) writeFileSync(settingsFile, settings);
	const repo = join(dir, "repo");
	mkdirSync(repo);
	const git = (...args) => spawnSync("git", args, { cwd: repo, encoding: "utf8" });
	git("init", "-q", "-b", "main");
	git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
	const wt = join(repo, ".claude", "worktrees", "wt");
	git("worktree", "add", "-q", "-b", "feat/wt", wt);
	const task = join(wt, "Plan-Final-v2.md");
	writeFileSync(task, "do the thing with $(rm -rf /) and `echo hi`\n");
	const log = join(dir, "pueue.log");
	writeFileSync(log, "");
	return {
		dir,
		repo,
		wt,
		task,
		log,
		run: (args, env = {}, cwd = wt) => spawnSync("zsh", [SPAWN, ...args], {
			encoding: "utf8",
			timeout: 20000,
			cwd,
			env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`, HOME: dir, PI_ROUTING_ENV: routingFile, PI_DISPATCH_SETTINGS: settingsFile, STUB_LOG: log, ...env },
		}),
		queued: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
	};
}

test("a tier resolves to its model from routing.env", () => {
	const box = sandbox();
	const result = box.run(["add", "--tier", "medium", "--task-file", box.task]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /model=opencode-go\/mid:medium/);
	assert.ok(box.queued()[0].argv.join(" ").includes("--model opencode-go/mid:medium"));
});

test("--tier with --model is refused", () => {
	const box = sandbox();
	const result = box.run(["add", "--tier", "high", "--model", "x/y", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(box.queued().length, 0);
});

test("a missing tier and missing model is refused", () => {
	const box = sandbox();
	const result = box.run(["add", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(box.queued().length, 0);
});

test("a tier absent from routing.env is refused", () => {
	const box = sandbox({ routing: "PI_DELEGATE_HIGH_MODEL=x/y\n" });
	const result = box.run(["add", "--tier", "low", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /PI_DELEGATE_LOW_MODEL is not set/);
});

test("--on is refused with exit 2 until the machine mesh lands", () => {
	const box = sandbox();
	const result = box.run(["add", "--on", "vps", "--tier", "high", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.equal(result.stderr.trim(), "pi-dispatch: --on arrives with the machine mesh (slice D)");
	assert.equal(box.queued().length, 0);
});

test("the queued command keeps the task text unexpanded", () => {
	const box = sandbox();
	box.run(["add", "--tier", "high", "--task-file", box.task]);
	const command = box.queued()[0].argv.join(" ");
	assert.ok(command.includes("$(cat "), "the task is read inside the pueue task");
	assert.ok(!command.includes("rm -rf"), "the task text itself is not in the queued command");
});

test("the slug is at most 16 characters and reduces the file name to a-z0-9-", () => {
	const box = sandbox();
	box.run(["add", "--tier", "high", "--task-file", box.task]);
	const label = box.queued()[0].argv[box.queued()[0].argv.indexOf("--label") + 1];
	assert.ok(label.length <= 16, label);
	assert.match(label, /^[a-z0-9-]+$/);
	assert.match(label, /-[0-9a-f]{4}$/);
});

test("PI_VIEW_APP=1 is set in the environment of the pueue add call", () => {
	const box = sandbox();
	box.run(["add", "--tier", "high", "--task-file", box.task]);
	assert.equal(box.queued()[0].viewApp, "1");
});

test("a value flag with no value exits 2 instead of looping", () => {
	const box = sandbox();
	const result = spawnSync("zsh", [SPAWN, "add", "--tier"], {
		encoding: "utf8",
		timeout: 5000,
		env: { PATH: "/usr/bin:/bin:/opt/homebrew/bin", HOME: box.dir },
	});
	assert.equal(result.status, 2, result.stderr);
	assert.match(result.stderr, /--tier needs a value/);
	assert.equal(box.queued().length, 0);
});

test("a quoted routing.env value loses its quotes", () => {
	const box = sandbox({ routing: 'PI_DELEGATE_HIGH_MODEL="opencode-go/high:high"\n' });
	const result = box.run(["add", "--tier", "high", "--task-file", box.task]);
	assert.equal(result.status, 0, result.stderr);
	assert.match(result.stdout, /model=opencode-go\/high:high\n/);
	assert.ok(!result.stdout.includes('"'), result.stdout);
	assert.ok(!box.queued()[0].argv.join(" ").includes('"opencode'), "no quote in the model");
});

const refused = (box, result, pattern) => {
	assert.equal(result.status, 2, result.stdout);
	if (pattern) assert.match(result.stderr, pattern);
	assert.equal(box.queued().length, 0, "nothing may be queued after a refusal");
};

test("status and log pass through; anything else is refused", () => {
	const box = sandbox();
	assert.equal(box.run(["status"]).status, 0);
	assert.equal(box.run(["log", "7"]).status, 0);
	assert.deepEqual(box.queued().map((q) => q.argv), [["status"], ["log", "7"]]);
	for (const args of [["log", "7;id"], ["log"], ["status", "-g", "x"], ["kill", "1"], ["--tier", "high"]]) {
		assert.equal(box.run(args).status, 2, args.join(" "));
	}
	assert.equal(box.queued().length, 2);
});

test("wait takes only numeric ids; --mode view drops --tui; an unknown mode is refused", () => {
	const box = sandbox();
	assert.equal(box.run(["wait", "3", "4"]).status, 0);
	assert.deepEqual(box.queued()[0].argv, ["wait", "3", "4"]);
	for (const args of [["wait"], ["wait", "3", "--group"], ["wait", "x"]]) assert.equal(box.run(args).status, 2, args.join(" "));
	assert.equal(box.run(["add", "--mode", "view", "--tier", "high", "--task-file", box.task]).status, 0);
	const viewed = box.queued()[1].argv.join(" ");
	assert.ok(viewed.includes("/pi-view pi --model") && !viewed.includes("--tui"), viewed);
	assert.equal(box.run(["add", "--tier", "high", "--task-file", box.task]).status, 0);
	assert.ok(box.queued()[2].argv.join(" ").includes("/pi-view --tui pi --model"), "tui stays the default");
	const other = sandbox();
	refused(other, other.run(["add", "--mode", "live", "--tier", "high", "--task-file", other.task]), /unknown --mode/);
});

test("an unknown thinking level or unreadable Pi settings is refused", () => {
	const box = sandbox();
	refused(box, box.run(["add", "--model", "opencode-go/high:turbo", "--task-file", box.task]), /thinking level/);
	const none = sandbox({ settings: null });
	refused(none, none.run(["add", "--tier", "high", "--task-file", none.task]), /enabledModels/);
	const bad = sandbox({ settings: "{not json" });
	refused(bad, bad.run(["add", "--tier", "high", "--task-file", bad.task]), /enabledModels/);
});

test("--cwd must be a linked worktree under .claude/worktrees", () => {
	const box = sandbox();
	refused(box, box.run(["add", "--tier", "high", "--task-file", box.task, "--cwd", box.repo]), /worktrees/);
	refused(box, box.run(["add", "--tier", "high", "--task-file", box.task, "--cwd", box.dir]), /not in a git repository/);
	refused(box, box.run(["add", "--tier", "high", "--task-file", box.task], {}, box.repo), /worktrees/);
});

test("--task-file must be an allow-listed regular file", () => {
	const box = sandbox();
	const secret = join(box.dir, "secrets", ".env");
	mkdirSync(join(box.dir, "secrets"));
	writeFileSync(secret, "KEY=v\n");
	refused(box, box.run(["add", "--tier", "high", "--task-file", secret]), /inside the worktree/);
	const link = join(box.wt, "link.md");
	symlinkSync(secret, link);
	refused(box, box.run(["add", "--tier", "high", "--task-file", link]), /symlink/);
	const big = join(box.wt, "big.md");
	writeFileSync(big, "x".repeat(300 * 1024));
	refused(box, box.run(["add", "--tier", "high", "--task-file", big]), /256 KiB/);
	const spaced = join(box.wt, "a plan.md");
	writeFileSync(spaced, "x\n");
	refused(box, box.run(["add", "--tier", "high", "--task-file", spaced]), /characters/);
	mkdirSync(join(box.dir, ".claude", "plans"), { recursive: true });
	const plan = join(box.dir, ".claude", "plans", "p.md");
	writeFileSync(plan, "x\n");
	assert.equal(box.run(["add", "--tier", "high", "--task-file", plan]).status, 0, "a plan in ~/.claude/plans is allowed");
});

// The allow-list now stops a metacharacter model before quoting matters; (q) quoting stays.
test("a --model outside enabledModels, such as one with shell metacharacters, is refused", () => {
	const box = sandbox();
	const result = box.run(["add", "--model", "x/y;touch PWNED", "--task-file", box.task]);
	assert.equal(result.status, 2);
	assert.match(result.stderr, /not in enabledModels/);
	assert.equal(box.queued().length, 0);
});
