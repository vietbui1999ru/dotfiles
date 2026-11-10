// Tests for the copyable error report (errorReport in the Herdr mods' logic.js). The function
// lives once per mod folder, since mods import nothing from outside their own folder; these tests
// check the behaviour once and fail if the copies drift apart.
// Run: node --test scripts/herdr-error-report.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as W from "../herdr-app/.config/herdr-app/mods/workspaces/logic.js";
import * as F from "../herdr-app/.config/herdr-app/mods/pi-fleet/logic.js";
import * as C from "../herdr-app/.config/herdr-app/mods/pi-changes/logic.js";

const FIXED = "2026-11-10T13:00:00+07:00";

test("a full report carries every field and the fixed first and last lines", () => {
	const text = W.errorReport({
		mod: "workspaces", action: "cleanup", target: "/r/.claude/worktrees/feat-x",
		argv: ["/r/dotfiles/scripts/jw", "rm", "feat-x"], cwd: "/r", code: 1,
		stdout: "out line", stderr: "uncommitted files", context: " M a.js", hint: "commit or stash", time: FIXED,
	});
	assert.equal(text.split("\n")[0], "# workspaces: cleanup failed");
	assert.match(text, /When: 2026-11-10T13:00:00\+07:00/);
	assert.match(text, /Target: \/r\/\.claude\/worktrees\/feat-x/);
	assert.match(text, /Working folder: \/r\n/);
	assert.match(text, /Command: `\/r\/dotfiles\/scripts\/jw rm feat-x`/);
	assert.match(text, /Exit code: 1/);
	assert.match(text, /stdout:\n```\nout line\n```/);
	assert.match(text, /stderr:\n```\nuncommitted files\n```/);
	assert.match(text, /Context:\n```\n M a\.js\n```/);
	assert.match(text, /Next step: commit or stash/);
	assert.ok(text.trimEnd().endsWith("Paste this into an agent session to investigate."));
});

test("missing optional fields are left out, never printed as undefined or null", () => {
	const text = W.errorReport({ mod: "pi-fleet", action: "approve", stderr: "boom", time: FIXED });
	assert.doesNotMatch(text, /undefined|null/);
	assert.doesNotMatch(text, /Target:|Working folder:|Command:|Exit code:|stdout:|Context:|Next step:/);
	assert.match(text, /stderr:\n```\nboom\n```/);
});

test("an empty string field is treated as missing", () => {
	const text = W.errorReport({ mod: "pi-changes", action: "preview", stdout: "", stderr: "", target: "", time: FIXED });
	assert.doesNotMatch(text, /stdout:|stderr:|Target:/);
});

test("stdout and stderr are cut at 4000 characters, with a note", () => {
	const big = "x".repeat(5000);
	const text = W.errorReport({ mod: "workspaces", action: "new", stderr: big, time: FIXED });
	const body = text.split("stderr:\n```\n")[1].split("\n```")[0];
	assert.equal(body.length, W.REPORT_LIMIT);
	assert.match(text, /stderr truncated to 4000 characters/);
});

test("text at exactly the limit is not cut", () => {
	const text = W.errorReport({ mod: "workspaces", action: "new", stdout: "y".repeat(W.REPORT_LIMIT), time: FIXED });
	assert.doesNotMatch(text, /truncated/);
});

test("argv is shell-quoted so the command can be re-run as written", () => {
	assert.equal(W.shellLine(["jw", "rm", "feat-x"]), "jw rm feat-x");
	assert.equal(W.shellLine(["open", "obsidian://open?path=a b"]), "open 'obsidian://open?path=a b'");
	assert.equal(W.shellLine(["echo", "it's"]), `echo 'it'\\''s'`);
	assert.equal(W.shellLine(["x", ""]), "x ''");
});

test("the three copies of errorReport are identical, so no mod drifts", () => {
	const copy = (mod) => {
		const s = readFileSync(`herdr-app/.config/herdr-app/mods/${mod}/logic.js`, "utf8");
		return s.slice(s.indexOf("// --------------------------------------------------------------- error reports"));
	};
	assert.equal(copy("pi-fleet"), copy("workspaces"));
	assert.equal(copy("pi-changes"), copy("workspaces"));
	assert.equal(C.REPORT_LIMIT, W.REPORT_LIMIT);
	assert.equal(F.REPORT_LIMIT, W.REPORT_LIMIT);
});
