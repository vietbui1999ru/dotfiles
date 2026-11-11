import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pi-sandbox");

// A fake home and a repo named like a system repo. Temp space is writable by design, so with
// a temp HOME only the profile's deny rules (which win, being last) can be asserted here.
const root = realpathSync(mkdtempSync(join(tmpdir(), "pi-sandbox-")));
const home = join(root, "home");
const repo = join(root, "dotfiles");
for (const dir of [join(home, ".pi/agent/extensions"), join(home, ".pi/agent/sessions"), join(home, "repos/Obsidian"), join(repo, "scripts")]) {
	mkdirSync(dir, { recursive: true });
}
spawnSync("git", ["init", "-q"], { cwd: repo });
after(() => rmSync(root, { recursive: true, force: true }));

// True when `sh -c "<write>"` succeeds inside the sandbox.
const writes = (command) =>
	spawnSync("zsh", [SCRIPT, "sh", "-c", command], {
		cwd: repo,
		encoding: "utf8",
		timeout: 10000,
		env: { ...process.env, HOME: home, PI_VIEW_SECRETS: join(root, "no-secrets") },
	}).status === 0;

test("writes inside the worktree and Pi's session store pass", () => {
	assert.ok(writes("echo x > note.txt"));
	assert.ok(writes(`touch '${home}/.pi/agent/sessions/s.jsonl'`));
});

test("Pi's extensions, the focus board and review decisions are read-only", () => {
	assert.ok(!writes(`echo x > '${home}/.pi/agent/extensions/x.ts'`));
	assert.ok(!writes(`echo x > '${home}/repos/Obsidian/Focus.md'`));
	assert.ok(!writes("echo x > .pi/agent-review/decisions/run.json"));
	assert.ok(existsSync(join(repo, ".pi/agent-review/decisions")), "the launcher creates decisions/ before the sandbox starts");
});

test("a system repo's harness folders are read-only", () => {
	assert.ok(!writes("echo x > scripts/tool.sh"));
	assert.ok(!writes("mkdir -p shared && echo x > shared/rule.md"));
});

test("refuses to run without a command", () => {
	const result = spawnSync("zsh", [SCRIPT], { encoding: "utf8" });
	assert.equal(result.status, 2);
});
