import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pi-pane-run");

// pi-pane-run <token> <watch-pid> <exit-file> <prompt-file> <pi command…>
// The token file sits next to the exit file, as pi-view writes it.
const run = ({ tokenOnDisk, passedToken, command = ["true"] }) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-pane-run-"));
	const exitFile = join(dir, "x.exit");
	const promptFile = join(dir, "x.prompt");
	const tokenFile = join(dir, "x.token");
	writeFileSync(promptFile, "hello");
	if (tokenOnDisk !== undefined) writeFileSync(tokenFile, tokenOnDisk);
	const result = spawnSync("zsh", [SCRIPT, passedToken, "999999", exitFile, promptFile, ...command], {
		encoding: "utf8",
		timeout: 10000,
		env: { ...process.env, HERDR_PANE_ID: "", HERDR_BIN_PATH: "/usr/bin/false" },
	});
	const exit = existsSync(exitFile) ? readFileSync(exitFile, "utf8").trim() : undefined;
	rmSync(dir, { recursive: true, force: true });
	return { status: result.status, exit, stderr: result.stderr };
};

test("writes the exit code when the token file matches", () => {
	const { exit } = run({ tokenOnDisk: "T1", passedToken: "T1", command: ["sh", "-c", "exit 3"] });
	assert.equal(exit, "3");
});

test("leaves the exit file alone when the token does not match", () => {
	const { status, exit } = run({ tokenOnDisk: "T2", passedToken: "T1", command: ["sh", "-c", "exit 4"] });
	assert.equal(exit, undefined, "a pane-run without the run's token must not write the exit file");
	// The script still exits with the command's code, so the pane's own status is unchanged.
	assert.equal(status, 4);
});

test("refuses fewer than 5 arguments with exit 2", () => {
	const result = spawnSync("zsh", [SCRIPT, "T1", "999999", "x.exit"], { encoding: "utf8", timeout: 10000 });
	assert.equal(result.status, 2);
});
