// Run: bun test pi/.pi/agent/extensions/lib/secrets-guard.test.ts
//
// No key-shaped literal appears here on purpose: the repo's own secret-scan runs on
// staged content and would refuse the commit.

import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	blockedCall,
	isInsideSecrets,
	namesSecretsPath,
	redactText,
	shouldRedact,
} from "./secrets-guard-core.ts";

const HOME = "/home/tester";
const CWD = "/home/tester/work";

test("namesSecretsPath catches every spelling of the directory", () => {
	for (const command of [
		"cat ~/secrets/.env",
		"cat $HOME/secrets/.env",
		"cat ${HOME}/secrets/.env",
		"cat /home/tester/secrets/.env",
		'cat ~/"sec"rets/.env',
		"ls -la ~/secrets",
		"git -C ~/secrets status",
	]) {
		assert.equal(namesSecretsPath(command, HOME), true, command);
	}
});

test("namesSecretsPath leaves lookalikes and plain searches alone", () => {
	for (const command of [
		"cat ~/secrets-backup/env",
		"rg 'secrets' docs/",
		"git status",
		"cat .env",
	]) {
		assert.equal(namesSecretsPath(command, HOME), false, command);
	}
});

test("isInsideSecrets resolves the path before judging it", () => {
	assert.equal(isInsideSecrets("~/secrets/.env", HOME, CWD), true);
	assert.equal(isInsideSecrets("secrets/.env", HOME, "/home/tester"), true);
	assert.equal(isInsideSecrets("../secrets/.env", HOME, CWD), true);
	assert.equal(isInsideSecrets("~/secrets", HOME, CWD), true);
	assert.equal(isInsideSecrets("~/secrets-guard/env", HOME, CWD), false);
	assert.equal(isInsideSecrets("src/secrets-guard.ts", HOME, CWD), false);
});

test("blockedCall refuses bash, path tools, MCP tools and codemode scripts", () => {
	const cases: Array<[{ toolName: string; input: Record<string, unknown> }, boolean]> = [
		[{ toolName: "bash", input: { command: "cat ~/secrets/.env" } }, true],
		[{ toolName: "read", input: { path: "/home/tester/secrets/.env" } }, true],
		[{ toolName: "ls", input: { path: "~/secrets" } }, true],
		[
			{ toolName: "ctx_execute", input: { code: "print(open('/home/tester/secrets/.env').read())" } },
			true,
		],
		// A bare relative spelling is any project's directory, not necessarily this one.
		[{ toolName: "grep", input: { pattern: "secrets/.env" } }, false],
		[{ toolName: "grep", input: { pattern: "KEY", path: "~/secrets" } }, true],
		[{ toolName: "bash", input: { command: "npm run build" } }, false],
		[{ toolName: "read", input: { path: "docs/workflows/secrets.md" } }, false],
		// A write is judged by its target, not by the text it carries, or writing the
		// guard's own source would be refused.
		[
			{ toolName: "write", input: { path: "notes.md", content: "keys live in ~/secrets/.env" } },
			false,
		],
	];
	for (const [call, expected] of cases) {
		assert.equal(blockedCall(call, HOME, CWD), expected, JSON.stringify(call));
	}
});

test("shouldRedact triggers on key shapes and key names only", () => {
	assert.equal(shouldRedact("CONTEXT7_API_KEY=abc123"), true);
	assert.equal(shouldRedact("Authorization: Bearer abc"), true);
	assert.equal(shouldRedact("export GITHUB_TOKEN=x"), true);
	assert.equal(shouldRedact(`prefix oc_sk_${"x".repeat(8)}`), true);
	assert.equal(shouldRedact("https://user:pass@example.com/repo"), true);
	assert.equal(shouldRedact("npm run build"), false);
	assert.equal(shouldRedact("const library = 1"), false);
	assert.equal(shouldRedact("pi/.pi/agent/extensions/secrets-guard.ts"), false);
});

test("redactText reports what the redactor prints, and undefined when it cannot run", () => {
	const dir = mkdtempSync(join(tmpdir(), "secrets-guard-"));
	try {
		const script = join(dir, "redact");
		writeFileSync(script, "#!/bin/sh\nsed 's/SECRET/[REDACTED]/g'\n");
		chmodSync(script, 0o700);
		assert.equal(redactText("a SECRET here", script), "a [REDACTED] here");
		assert.equal(redactText("a SECRET here\n", script), "a [REDACTED] here\n");
		assert.equal(redactText("clean text\n", script), "clean text\n");
		assert.equal(redactText("anything", join(dir, "missing")), undefined);
		assert.equal(redactText("", script), undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
