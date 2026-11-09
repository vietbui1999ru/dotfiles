// Run: node --test scripts/pi-view-app.test.mjs
//
// pi-view-app drives hc, herdr-app and pi-checks. Each is replaced by a stub on PATH or
// through an override, and every stub records its argv, so the tests check what the
// script asked for without a real terminal.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPTS = dirname(fileURLToPath(import.meta.url));

// A stub executable that appends its argv to a log and answers from env-driven scripts.
const HC_STUB = `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(["hc", ...args]) + "\\n");
if (args[0] === "run") {
  if (process.env.STUB_HC_RUN_FAIL === "1") process.exit(1);
  process.stdout.write(JSON.stringify({ address: process.env.STUB_ADDRESS ?? "t9", state: "live", turn: 0 }) + "\\n");
  process.exit(0);
}
if (args[0] === "get") {
  // STUB_GET_FILE holds a queue of answers; each call consumes one line.
  const file = process.env.STUB_GET_FILE;
  const lines = existsSync(file) ? readFileSync(file, "utf8").split("\\n").filter(Boolean) : [];
  // An empty queue means the terminal has finished, as a real one does once its program ends.
  const answer = lines.shift() ?? JSON.stringify({ address: "t9", state: "finished", exit_code: 0, status: null });
  // Copy the pane file as the first poll sees it, so a test can read it after the run.
  if (process.env.STUB_PANE_SNAPSHOT && existsSync(process.env.STUB_PANE_FILE)) {
    writeFileSync(process.env.STUB_PANE_SNAPSHOT, readFileSync(process.env.STUB_PANE_FILE, "utf8"));
  }
  if (process.env.STUB_EXIT_WHEN_DONE && lines.length === 0 && process.env.STUB_EXIT_FILE) {
    writeFileSync(process.env.STUB_EXIT_FILE, process.env.STUB_EXIT_WHEN_DONE);
  }
  writeFileSync(file, lines.join("\\n") + (lines.length ? "\\n" : ""));
  if (answer === "FAIL") process.exit(1);
  process.stdout.write(answer + "\\n");
  process.exit(0);
}
process.exit(0);
`;

const HERDR_APP_STUB = `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(process.env.STUB_LOG, JSON.stringify(["herdr-app", ...args]) + "\\n");
process.exit(process.env.STUB_KEEP_FAIL === "1" ? 1 : 0);
`;

// Stands in for pi-checks.mjs: records each call, so the test can count settles.
const CHECKS_STUB = `import { appendFileSync } from "node:fs";
appendFileSync(process.env.STUB_LOG, JSON.stringify(["pi-checks", ...process.argv.slice(2)]) + "\\n");
`;

// Stands in for pi-pane-run: writes the exit code the test asks for, like the real one.
const PANE_RUN_STUB = `#!/bin/sh
exit_file="$3"
printf '%s' "\${STUB_PANE_RC:-0}" > "$exit_file"
exit 0
`;

function sandbox({ getAnswers = [], hcRunFail = false, keepFail = false } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pi-view-app-test-"));
	const bin = join(dir, "bin");
	const tmp = join(dir, "tmp");
	const app = join(dir, "scripts");
	mkdirSync(bin);
	mkdirSync(tmp);
	mkdirSync(app);

	// The script under test, with its sibling stubs beside it.
	copyFileSync(join(SCRIPTS, "pi-view-app"), join(app, "pi-view-app"));
	chmodSync(join(app, "pi-view-app"), 0o755);
	writeFileSync(join(app, "pi-checks.mjs"), CHECKS_STUB);
	writeFileSync(join(app, "pi-pane-run"), PANE_RUN_STUB);
	chmodSync(join(app, "pi-pane-run"), 0o755);
	writeFileSync(join(app, "pi-tail.mjs"), "");
	writeFileSync(join(app, "pi-live.mjs"), "");

	const hc = join(bin, "hc");
	writeFileSync(hc, HC_STUB);
	chmodSync(hc, 0o755);
	const herdrApp = join(bin, "herdr-app");
	writeFileSync(herdrApp, HERDR_APP_STUB);
	chmodSync(herdrApp, 0o755);

	const log = join(dir, "calls.log");
	writeFileSync(log, "");
	const getFile = join(dir, "get-answers");
	writeFileSync(getFile, getAnswers.join("\n") + (getAnswers.length ? "\n" : ""));

	return {
		dir,
		tmp,
		log,
		run: (args, env = {}) => spawnSync("zsh", [join(app, "pi-view-app"), ...args], {
			encoding: "utf8",
			timeout: 20000,
			env: {
				PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`,
				HOME: dir,
				TMPDIR: `${tmp}/`,
				HC_BIN_PATH: hc,
				HERDR_APP_BIN_PATH: herdrApp,
				PI_VIEW_APP_SETTLE: "0",
				PI_VIEW_APP_POLL: "0",
				STUB_LOG: log,
				STUB_GET_FILE: getFile,
				STUB_HC_RUN_FAIL: hcRunFail ? "1" : "0",
				STUB_KEEP_FAIL: keepFail ? "1" : "0",
				...env,
			},
		}),
		calls: () => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)),
		runDir: () => join(tmp, "pi-view"),
	};
}

const RUN = ["--session-id", "pueue-7-abcd", "--model", "m", "-p", "hi"];
const piRun = ["pi", ...RUN];

const hcRunCall = (calls) => calls.find((call) => call[0] === "hc" && call[1] === "run");

test("window mode starts a detached terminal with both labels, its cwd, and no key value", () => {
	const box = sandbox({ getAnswers: [] });
	writeFileSync(join(box.dir, "dummy"), "");
	const result = box.run(["--mode", "view", "--", ...piRun], { CONTEXT7_API_KEY: "sekrit-value" });
	const run = hcRunCall(box.calls());
	assert.ok(run, "hc run was called");
	for (const flag of ["--bg", "--no-parent", "--outlive-parent", "--no-notify", "--cwd"]) {
		assert.ok(run.includes(flag), `missing ${flag} in ${run.join(" ")}`);
	}
	assert.ok(run.includes("pi.window=1"), "window placement labels the terminal");
	assert.ok(run.includes("pi.session=pueue-7-abcd"));
	assert.ok(!JSON.stringify(box.calls()).includes("sekrit-value"), "no key value on any recorded argv");
	// No exit file is written by a stub Pi command, so the run reports failure by design.
	assert.equal(result.status, 1, result.stderr);
});

test("writes hc:<address> to the pane file while the run is live", () => {
	const live = JSON.stringify({ address: "t9", state: "live", status: null });
	const box = sandbox({ getAnswers: [live] });
	mkdirSync(box.runDir(), { recursive: true });
	const snapshot = join(box.dir, "pane-snapshot");
	box.run(["--mode", "tui", "--", ...piRun], {
		STUB_EXIT_FILE: join(box.runDir(), "pueue-7-abcd.exit"),
		STUB_EXIT_WHEN_DONE: "0",
		STUB_PANE_FILE: join(box.runDir(), "pueue-7-abcd.pane"),
		STUB_PANE_SNAPSHOT: snapshot,
	});
	assert.equal(readFileSync(snapshot, "utf8").trim(), "hc:t9");
});

test("tui mode: the exit file's code becomes the process's code", () => {
	const live = JSON.stringify({ address: "t9", state: "live", status: null });
	const box = sandbox({ getAnswers: [live] });
	mkdirSync(box.runDir(), { recursive: true });
	const result = box.run(["--mode", "tui", "--", ...piRun], {
		STUB_EXIT_FILE: join(box.runDir(), "pueue-7-abcd.exit"),
		STUB_EXIT_WHEN_DONE: "5",
	});
	assert.equal(result.status, 5, result.stderr);
});

test("tui mode: a terminal that finished with no exit file exits 1, even with exit_code 0", () => {
	const finished = JSON.stringify({ address: "t9", state: "finished", exit_code: 0, reason: "killed", status: null });
	const box = sandbox({ getAnswers: [finished] });
	const result = box.run(["--mode", "tui", "--", ...piRun]);
	assert.equal(result.status, 1);
});

test("tui mode: turn 0 idle does not start pi-checks, turn 1 done does", () => {
	const startup = JSON.stringify({ address: "t9", state: "live", status: { app: "pi", state: "idle" }, turn: 0 });
	const done = JSON.stringify({ address: "t9", state: "live", status: { app: "pi", state: "done" }, turn: 1 });
	const settledCalls = (box) => box.calls().filter((call) => call[0] === "pi-checks" && !call.includes("--no-steer"));

	const early = sandbox({ getAnswers: [startup] });
	mkdirSync(early.runDir(), { recursive: true });
	early.run(["--mode", "tui", "--", ...piRun], { STUB_EXIT_FILE: join(early.runDir(), "pueue-7-abcd.exit"), STUB_EXIT_WHEN_DONE: "0" });
	assert.equal(settledCalls(early).length, 0, "startup at turn 0 must not settle");

	const settled = sandbox({ getAnswers: [done] });
	mkdirSync(settled.runDir(), { recursive: true });
	settled.run(["--mode", "tui", "--", ...piRun], { STUB_EXIT_FILE: join(settled.runDir(), "pueue-7-abcd.exit"), STUB_EXIT_WHEN_DONE: "0" });
	assert.equal(settledCalls(settled).length, 1, "a settled turn starts pi-checks once");
});

test("a failing hc run runs the command plainly", () => {
	const box = sandbox({ hcRunFail: true });
	// `true` ends the plain run successfully, so the exit code proves the command ran.
	const result = box.run(["--mode", "view", "--", "sh", "-c", "exit 4", "--session-id", "pueue-7-abcd"]);
	assert.equal(result.status, 4);
});

test("PI_VIEW_PLACE=split omits pi.window and calls terminal.keep --place right", () => {
	const box = sandbox({ getAnswers: [] });
	box.run(["--mode", "view", "--", ...piRun], { PI_VIEW_PLACE: "split" });
	const run = hcRunCall(box.calls());
	assert.ok(!run.includes("pi.window=1"));
	const keep = box.calls().find((call) => call[0] === "herdr-app");
	assert.deepEqual(keep.slice(1), ["do", "terminal.keep", "--terminal", "t9", "--place", "right"]);
});

test("a failed terminal.keep falls back to hc label pi.window=1", () => {
	const box = sandbox({ getAnswers: [], keepFail: true });
	box.run(["--mode", "view", "--", ...piRun], { PI_VIEW_PLACE: "split" });
	const label = box.calls().find((call) => call[0] === "hc" && call[1] === "label");
	assert.deepEqual(label, ["hc", "label", "t9", "pi.window=1"]);
});

// pi-view hands off to pi-view-app only outside a Herdr pane. The focus check is stubbed
// to pass, and the handoff target is replaced so a reached handoff is recorded.
function viewSandbox() {
	const dir = mkdtempSync(join(tmpdir(), "pi-view-handoff-"));
	const bin = join(dir, "bin");
	mkdirSync(bin);
	const app = join(dir, "scripts");
	mkdirSync(app);
	copyFileSync(join(SCRIPTS, "pi-view"), join(app, "pi-view"));
	chmodSync(join(app, "pi-view"), 0o755);
	writeFileSync(join(app, "focus"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(app, "focus"), 0o755);
	writeFileSync(join(app, "secret-get"), "#!/bin/sh\nexit 1\n");
	chmodSync(join(app, "secret-get"), 0o755);
	writeFileSync(join(app, "provenance"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(app, "provenance"), 0o755);
	writeFileSync(join(app, "pi-view-app"), "#!/bin/sh\necho reached-app >> \"$HANDOFF_LOG\"\nexit 0\n");
	chmodSync(join(app, "pi-view-app"), 0o755);
	writeFileSync(join(bin, "hc"), "#!/bin/sh\nexit 0\n");
	chmodSync(join(bin, "hc"), 0o755);
	const log = join(dir, "handoff.log");
	writeFileSync(log, "");
	return {
		run: (env) => spawnSync("zsh", [join(app, "pi-view"), "sh", "-c", "exit 0", "pi", "--session-id", "pueue-x", "-p", "hi"], {
			encoding: "utf8",
			timeout: 20000,
			cwd: dir,
			env: { PATH: `${bin}:/usr/bin:/bin:/opt/homebrew/bin`, HOME: dir, TMPDIR: `${dir}/`, PI_VIEW_SECRETS: join(dir, "none.env"), HANDOFF_LOG: log, ...env },
		}),
		reached: () => readFileSync(log, "utf8").includes("reached-app"),
	};
}

test("pi-view inside a Herdr pane never reaches pi-view-app, even with an hc terminal", () => {
	const box = viewSandbox();
	box.run({ HERDR_ENV: "1", HC_TERMINAL_ID: "t3" });
	assert.equal(box.reached(), false);
});

test("pi-view outside any terminal does not reach pi-view-app", () => {
	const box = viewSandbox();
	box.run({});
	assert.equal(box.reached(), false);
});

test("pi-view inside an hc terminal hands off to pi-view-app", () => {
	const box = viewSandbox();
	box.run({ HC_TERMINAL_ID: "t3" });
	assert.equal(box.reached(), true);
});
