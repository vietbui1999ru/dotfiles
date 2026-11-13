import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, existsSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "pi-sandbox");
const onMac = process.platform === "darwin";
const needsSeatbelt = { skip: !onMac && "needs macOS Seatbelt" };

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

// Claude's settings are the policy source; this fixture stands in for ~/.claude/settings.json.
const settings = join(root, "settings.json");
writeFileSync(settings, JSON.stringify({ sandbox: { filesystem: { denyWrite: [
	"~/.pi/agent/extensions", "~/repos/Obsidian/Focus.md", "**/.pi/agent-review/decisions",
] } } }));
const sandboxEnv = (extra = {}) => ({ ...process.env, HOME: home, PI_VIEW_SECRETS: join(root, "no-secrets"), PI_SANDBOX_SETTINGS: settings, ...extra });
const inSandbox = (args, extra) => spawnSync("zsh", [SCRIPT, ...args], { cwd: repo, encoding: "utf8", timeout: 10000, env: sandboxEnv(extra) });

// True when `sh -c "<write>"` succeeds inside the sandbox.
const writes = (command) => inSandbox(["sh", "-c", command]).status === 0;

test("writes inside the worktree and Pi's session store pass", needsSeatbelt, () => {
	assert.ok(writes("echo x > note.txt"));
	assert.ok(writes(`touch '${home}/.pi/agent/sessions/s.jsonl'`));
});

test("Pi's extensions, the focus board and review decisions are read-only", needsSeatbelt, () => {
	assert.ok(!writes(`echo x > '${home}/.pi/agent/extensions/x.ts'`));
	assert.ok(!writes(`echo x > '${home}/repos/Obsidian/Focus.md'`));
	assert.ok(!writes("echo x > .pi/agent-review/decisions/run.json"));
	assert.ok(existsSync(join(repo, ".pi/agent-review/decisions")), "the launcher creates decisions/ before the sandbox starts");
});

// Decided 2026-11-11: harness folders stay writable in worktrees until system-pin (Slice S4).
test("a system repo's harness folders stay writable in a worktree until S4", needsSeatbelt, () => {
	assert.ok(writes("echo x > scripts/tool.sh"));
});

// A previous run can write .jj/repo and .git in its worktree; a planted pointer must not widen
// the next run's write grant to another directory.
const launch = (cwd) => spawnSync("zsh", [SCRIPT, "true"], { cwd, encoding: "utf8", env: sandboxEnv() });

test("missing or sandbox-less settings refuse the run", needsSeatbelt, () => {
	for (const bad of [join(root, "absent.json"), join(root, "empty.json")]) {
		writeFileSync(join(root, "empty.json"), "{}");
		const result = inSandbox(["true"], { PI_SANDBOX_SETTINGS: bad });
		assert.equal(result.status, 1, bad);
		assert.match(result.stderr, /no usable sandbox policy/);
	}
});

test("git hooks and config are protected, while a commit still works", needsSeatbelt, () => {
	assert.ok(!writes("echo x > .git/hooks/post-commit"), "a git hook write passed");
	assert.ok(!writes("git config core.hooksPath /tmp"), "a git config write passed");
	assert.ok(writes("git -c user.name=t -c user.email=t@t commit -q --allow-empty -m probe"), "a commit failed");
});

test("the herdr control socket is unreachable", needsSeatbelt, async () => {
	const { createServer } = await import("node:net");
	// A unix socket path is capped at 104 bytes on macOS, and the per-user temp dir alone is
	// ~60, so this test gets its own short HOME under /tmp.
	const shortHome = realpathSync(mkdtempSync("/tmp/psb-"));
	const dir = join(shortHome, ".local/state/herdr-core/default");
	mkdirSync(dir, { recursive: true });
	const sock = join(dir, "default.sock");
	const server = createServer().listen(sock);
	await new Promise((resolve) => server.once("listening", resolve));
	const connect = `import socket,sys; s=socket.socket(socket.AF_UNIX); s.connect(sys.argv[1])`;
	const outside = spawnSync("python3", ["-I", "-c", connect, sock]);
	const inside = inSandbox(["python3", "-I", "-c", connect, sock], { HOME: shortHome });
	server.close();
	rmSync(shortHome, { recursive: true, force: true });
	assert.equal(outside.status, 0, "control: the socket accepts outside the sandbox");
	assert.notEqual(inside.status, 0, "the socket was reachable inside the sandbox");
});

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

test("refuses to run without a command", needsSeatbelt, () => {
	const result = spawnSync("zsh", [SCRIPT], { encoding: "utf8" });
	assert.equal(result.status, 2);
});

// Linux has no sandbox yet: the run is allowed only with the person's hand-made opt-in file.
// Stubs put `uname` and `hostname` first on PATH so the Linux branch runs on macOS.
const stubs = join(root, "stubs");
mkdirSync(stubs, { recursive: true });
writeFileSync(join(stubs, "uname"), "#!/bin/sh\necho Linux\n", { mode: 0o755 });
writeFileSync(join(stubs, "hostname"), "#!/bin/sh\necho testbox\n", { mode: 0o755 });
const linuxEnv = (extra = {}) => sandboxEnv({ PATH: `${stubs}:${process.env.PATH}`, ...extra });
const optIn = join(home, ".config/pi-sandbox/linux-open");
const writeOptIn = (content, mode = 0o600) => {
	mkdirSync(dirname(optIn), { recursive: true });
	rmSync(optIn, { force: true });
	writeFileSync(optIn, content, { mode });
	chmodSync(optIn, mode);
};
const runLinux = (args, extra) => spawnSync("zsh", [SCRIPT, ...args], { cwd: repo, encoding: "utf8", timeout: 10000, env: linuxEnv(extra) });
const UNSANDBOXED = /pi-sandbox: UNSANDBOXED on testbox \(opt-in ~\/\.config\/pi-sandbox\/linux-open\); Pi can write anywhere you can, including ~\/dotfiles and ~\/\.claude/;
const REFUSED = /no sandbox on Linux and no valid opt-in/;

test("Linux runs the command when the opt-in is valid, and says so once", () => {
	writeOptIn("unsandboxed-ok testbox\n");
	const result = runLinux(["sh", "-c", "exit 7"]);
	assert.equal(result.status, 7, "the command's exit status is passed through");
	assert.equal(result.stderr.match(new RegExp(UNSANDBOXED.source, "g"))?.length, 1, result.stderr);
});

test("Linux refuses without an opt-in file, and does not run the command", () => {
	rmSync(optIn, { force: true });
	const marker = join(root, "ran-without-optin");
	const result = runLinux(["sh", "-c", `touch '${marker}'`]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
	assert.ok(!existsSync(marker), "the command ran");
});

test("Linux refuses an opt-in that names another host", () => {
	writeOptIn("unsandboxed-ok otherbox\n");
	const result = runLinux(["true"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
});

test("Linux refuses an opt-in with mode 644", () => {
	writeOptIn("unsandboxed-ok testbox\n", 0o644);
	const result = runLinux(["true"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
});

test("Linux refuses an opt-in that is a symlink to a valid file", () => {
	writeOptIn("unsandboxed-ok testbox\n");
	const target = join(root, "real-optin");
	writeFileSync(target, "unsandboxed-ok testbox\n", { mode: 0o600 });
	rmSync(optIn, { force: true });
	symlinkSync(target, optIn);
	const result = runLinux(["true"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
});

test("Linux refuses an opt-in with two lines", () => {
	writeOptIn("unsandboxed-ok testbox\nextra\n");
	const result = runLinux(["true"]);
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
});

test("an environment variable cannot grant the Linux opt-in", () => {
	rmSync(optIn, { force: true });
	const result = runLinux(["true"], { PI_SANDBOX_OPEN: "1" });
	assert.equal(result.status, 1);
	assert.match(result.stderr, REFUSED);
});

test("an unknown system refuses the run", () => {
	const fakeStubs = join(root, "stubs-other");
	mkdirSync(fakeStubs, { recursive: true });
	writeFileSync(join(fakeStubs, "uname"), "#!/bin/sh\necho FreeBSD\n", { mode: 0o755 });
	const result = spawnSync("zsh", [SCRIPT, "true"], { cwd: repo, encoding: "utf8", env: sandboxEnv({ PATH: `${fakeStubs}:${process.env.PATH}` }) });
	assert.equal(result.status, 1);
	assert.match(result.stderr, /unsupported system FreeBSD/);
});
