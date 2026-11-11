import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pi-sandbox");

// A fake home and a repo named like a system repo (dotfiles). Temp space is writable by design, so with
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

// Decided 2026-11-11: harness folders stay writable in worktrees until system-pin (Slice S4).
test("a system repo's harness folders stay writable in a worktree until S4", () => {
	assert.ok(writes("echo x > scripts/tool.sh"));
});

// A previous run can write .jj/repo and .git in its worktree; a planted pointer must not widen
// the next run's write grant to another directory.
const launch = (cwd) =>
	spawnSync("zsh", [SCRIPT, "true"], { cwd, encoding: "utf8", env: { ...process.env, HOME: home, PI_VIEW_SECRETS: join(root, "no-secrets") } });

test("refuses a .jj/repo pointer that leaves the repo", () => {
	const planted = join(root, "planted");
	mkdirSync(join(planted, ".jj"), { recursive: true });
	spawnSync("git", ["init", "-q"], { cwd: planted });
	writeFileSync(join(planted, ".jj/repo"), "../../home");
	const result = launch(planted);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /jj store .* is outside/);
});

test("refuses a .git pointer into a repo the folder is not a worktree of", () => {
	const forged = join(root, "forged");
	mkdirSync(forged, { recursive: true });
	writeFileSync(join(forged, ".git"), `gitdir: ${join(repo, ".git")}\n`);
	const result = launch(forged);
	assert.equal(result.status, 1);
	assert.match(result.stderr, /not a worktree of/);
});

test("refuses to run without a command", () => {
	const result = spawnSync("zsh", [SCRIPT], { encoding: "utf8" });
	assert.equal(result.status, 2);
});
