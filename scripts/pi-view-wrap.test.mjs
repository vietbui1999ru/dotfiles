// Run: node --test scripts/pi-view-wrap.test.mjs
//
// pi-view must wrap every run in pi-sandbox, with no opt-out. A copy of pi-view runs beside a
// stub pi-sandbox that records its argv, so the test sees what pi-view execs outside herdr.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const PI_VIEW = join(dirname(fileURLToPath(import.meta.url)), "pi-view");

function stubDir() {
	const dir = realpathSync(mkdtempSync(join(tmpdir(), "pi-view-wrap-")));
	copyFileSync(PI_VIEW, join(dir, "pi-view"));
	const stub = (name, body) => {
		writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`);
		chmodSync(join(dir, name), 0o755);
	};
	stub("pi-sandbox", `printf '%s\\n' "$@" > "${dir}/sandbox.argv"`);
	stub("focus", "exit 0");
	return dir;
}

for (const mode of [[], ["--tui"]]) {
	test(`pi-view ${mode.join(" ") || "(plain)"} runs Pi through pi-sandbox outside herdr`, () => {
		const dir = stubDir();
		const result = spawnSync("zsh", [join(dir, "pi-view"), ...mode, "pi", "--model", "m", "-p", "hi"], {
			encoding: "utf8",
			timeout: 10000,
			cwd: dir,
			env: { PATH: "/usr/bin:/bin", HOME: dir, TMPDIR: dir, PI_VIEW_SECRETS: join(dir, "none") },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.deepEqual(readFileSync(join(dir, "sandbox.argv"), "utf8").trim().split("\n"), ["pi", "--model", "m", "-p", "hi"]);
	});
}

test("the pi-sandbox wrap comes before every exec of the run's argv", () => {
	const lines = readFileSync(PI_VIEW, "utf8").split("\n");
	const wrap = lines.findIndex((line) => line.startsWith('set -- "$script_dir/pi-sandbox" "$@"'));
	assert.ok(wrap > 0, "the wrap line is missing");
	lines.forEach((line, index) => {
		if (/\bexec\b.*"\$@"|\bnode\b.*"\$@"/.test(line)) assert.ok(index > wrap, `line ${index + 1} runs "$@" before the wrap: ${line.trim()}`);
	});
	assert.ok(!/PI_VIEW_NO_SANDBOX|--no-sandbox|unsandboxed\)/.test(lines.join("\n")), "an opt-out appeared");
});
