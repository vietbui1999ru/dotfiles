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

// The context key comes from the secrets file through secret-get, never from the caller.
const runWithSecrets = ({ secrets, preset }) => {
	const dir = mkdtempSync(join(tmpdir(), "pi-pane-run-key-"));
	const exitFile = join(dir, "x.exit");
	const promptFile = join(dir, "x.prompt");
	const secretsFile = join(dir, "secrets.env");
	writeFileSync(promptFile, "hello");
	writeFileSync(secretsFile, secrets, { mode: 0o600 });
	const env = { ...process.env, HERDR_PANE_ID: "", HERDR_BIN_PATH: "/usr/bin/false", PI_VIEW_SECRETS: secretsFile };
	delete env.CONTEXT7_API_KEY;
	if (preset !== undefined) env.CONTEXT7_API_KEY = preset;
	const seen = join(dir, "seen");
	const result = spawnSync("zsh", [SCRIPT, "T1", "999999", exitFile, promptFile, "sh", "-c", `printf %s "$CONTEXT7_API_KEY" > ${seen}`], {
		encoding: "utf8",
		timeout: 10000,
		env,
	});
	const value = existsSync(seen) ? readFileSync(seen, "utf8") : undefined;
	rmSync(dir, { recursive: true, force: true });
	return { status: result.status, value };
};

test("loads CONTEXT7_API_KEY from the secrets file when it is unset", () => {
	const { value } = runWithSecrets({ secrets: "CONTEXT7_API_KEY=ctx-from-file\n" });
	assert.equal(value, "ctx-from-file");
});

test("keeps an already-set CONTEXT7_API_KEY", () => {
	const { value } = runWithSecrets({ secrets: "CONTEXT7_API_KEY=ctx-from-file\n", preset: "ctx-preset" });
	assert.equal(value, "ctx-preset");
});
