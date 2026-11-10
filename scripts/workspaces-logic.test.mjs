// Tests for the Workspaces mod's pure logic (herdr-app mods/workspaces/logic.js).
// Run: node --test scripts/workspaces-logic.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import * as L from "../herdr-app/.config/herdr-app/mods/workspaces/logic.js";

test("parseWorktrees reads each block: path, branch, detached, prunable, bare", () => {
	const text = [
		"worktree /r/dotfiles",
		"HEAD 53d88d7aaaa",
		"branch refs/heads/main",
		"",
		"worktree /r/dotfiles/.claude/worktrees/feat-x",
		"HEAD b36002eeee",
		"branch refs/heads/feat/x",
		"",
		"worktree /r/dotfiles/.claude/worktrees/old",
		"HEAD 5f6c987aaa",
		"detached",
		"prunable gitdir file points to non-existent location",
		"",
		"worktree /r/bare.git",
		"bare",
		"",
	].join("\n");
	const rows = L.parseWorktrees(text);
	assert.equal(rows.length, 3, "a bare entry is dropped");
	assert.deepEqual(rows[0], { path: "/r/dotfiles", branch: "main", head: "53d88d7aaaa", detached: false, bare: false, prunable: false });
	assert.equal(rows[1].branch, "feat/x");
	assert.equal(rows[2].detached, true);
	assert.equal(rows[2].branch, null);
	assert.equal(rows[2].prunable, true);
});

test("parseWorktrees on empty input is an empty list", () => {
	assert.deepEqual(L.parseWorktrees(""), []);
	assert.deepEqual(L.parseWorktrees(undefined), []);
});

test("countChanges counts NUL-separated status entries, untracked included", () => {
	assert.equal(countOf(" M a.js\0?? new.txt\0A  b.js\0"), 3);
	assert.equal(countOf(""), 0);
});
const countOf = (s) => L.countChanges(s);

test("parseAheadBehind reads <behind>\\t<ahead>; no upstream is null", () => {
	assert.deepEqual(L.parseAheadBehind("2\t5\n"), { behind: 2, ahead: 5 });
	assert.deepEqual(L.parseAheadBehind("0 0"), { behind: 0, ahead: 0 });
	assert.deepEqual(L.parseAheadBehind(null), { behind: null, ahead: null });
	assert.deepEqual(L.parseAheadBehind("garbage"), { behind: null, ahead: null });
});

test("merged state comes from gh first, the git fallback second, else unknown", () => {
	assert.equal(L.mergedState("feat/x", { prMerged: ["feat/x"], gitMerged: [] }), "merged");
	assert.equal(L.mergedState("feat/y", { prMerged: ["feat/x"], gitMerged: [] }), "not merged");
	// gh failed (null): the fallback decides, and git does not see squash merges.
	assert.equal(L.mergedState("feat/x", { prMerged: null, gitMerged: ["feat/x"] }), "merged");
	assert.equal(L.mergedState("feat/x", { prMerged: null, gitMerged: [] }), "not merged");
	// gh and git both failed: unknown, never not merged.
	assert.equal(L.mergedState("feat/x", { prMerged: null, gitMerged: null }), "unknown");
	assert.equal(L.mergedState("feat/x", {}), "unknown");
	// A detached worktree has no branch to judge.
	assert.equal(L.mergedState(null, { prMerged: [] }), "unknown");
});

test("parsePrMerged reads headRefName; a bad payload is null (the fallback), not empty", () => {
	assert.deepEqual(L.parsePrMerged('[{"headRefName":"feat/a"},{"headRefName":"fix/b"}]'), ["feat/a", "fix/b"]);
	assert.deepEqual(L.parsePrMerged("[]"), []);
	assert.equal(L.parsePrMerged("not json"), null);
	assert.equal(L.parsePrMerged('{"x":1}'), null);
});

test("parseGitMerged reads one branch per line", () => {
	assert.deepEqual(L.parseGitMerged("main\nfeat/a\n\n  fix/b \n"), ["main", "feat/a", "fix/b"]);
});

test("live: a terminal cwd equal to or under the worktree is live; a sibling prefix is not", () => {
	assert.equal(L.liveState("/x/foo", ["/x/foo"]), true);
	assert.equal(L.liveState("/x/foo", ["/x/foo/src/deep"]), true);
	assert.equal(L.liveState("/x/foo", ["/x/foobar"]), false, "a sibling sharing a prefix is not inside");
	assert.equal(L.liveState("/x/foo", ["/x"]), false, "a parent is not inside");
	assert.equal(L.liveState("/x/foo", []), false);
	assert.equal(L.liveState("/x/foo", undefined), false);
});

test("live: a cwd in a nested worktree belongs to the deepest one, not the main worktree", () => {
	const all = ["/r/d", "/r/d/.claude/worktrees/w1"];
	assert.equal(L.liveState("/r/d", ["/r/d/.claude/worktrees/w1/src"], all), false, "the main worktree is not live for a nested cwd");
	assert.equal(L.liveState("/r/d/.claude/worktrees/w1", ["/r/d/.claude/worktrees/w1/src"], all), true);
	assert.equal(L.liveState("/r/d", ["/r/d/src"], all), true, "a cwd only in the main worktree is live there");
});

test("isInside handles a trailing slash and the root", () => {
	assert.equal(L.isInside("/x/foo/", "/x/foo"), true);
	assert.equal(L.isInside("/x/foo", "/x/foo/"), true);
	assert.equal(L.isInside("/a", "/"), true);
	assert.equal(L.isInside("", "/x"), false);
});

test("decorate joins status, tracking, merged and live onto each row", () => {
	const rows = L.parseWorktrees("worktree /r/d\nbranch refs/heads/main\n\nworktree /r/d/.claude/worktrees/w1\nbranch refs/heads/feat/w1\n");
	const out = L.decorate(rows, {
		changes: { "/r/d/.claude/worktrees/w1": 3 },
		tracking: { "/r/d/.claude/worktrees/w1": { behind: 1, ahead: 2 } },
		merged: { prMerged: ["feat/w1"], gitMerged: [] },
		cwds: ["/r/d/.claude/worktrees/w1/src"],
	});
	assert.equal(out[1].changes, 3);
	assert.deepEqual([out[1].behind, out[1].ahead], [1, 2]);
	assert.equal(out[1].merged, "merged");
	assert.equal(out[1].live, true);
	assert.equal(out[0].live, false);
	assert.equal(out[0].changes, 0);
});

test("cleanupRows: only merged, managed, not live, not prunable, with a branch", () => {
	const repo = "/r/d";
	const row = (p, extra) => ({ path: p, branch: "feat/b", merged: "merged", live: false, prunable: false, ...extra });
	const rows = [
		row("/r/d", { branch: "main" }), // the main worktree
		row("/r/d/.claude/worktrees/ok"),
		row("/r/d/.claude/worktrees/unmerged", { merged: "not merged" }),
		row("/r/d/.claude/worktrees/live", { live: true }),
		row("/r/d/.claude/worktrees/gone", { prunable: true }),
		row("/r/d-other/.claude/worktrees/sib"), // a sibling repo path, not managed here
		row("/elsewhere/manual"), // not under .claude/worktrees
		row("/r/d/.claude/worktrees/detached", { branch: null }),
	];
	const names = L.cleanupRows(rows, repo).map((r) => r.path);
	assert.deepEqual(names, ["/r/d/.claude/worktrees/ok"]);
});

test("argv builders return arrays, never shell strings", () => {
	const home = "/Users/me";
	const row = { path: "/r/d/.claude/worktrees/ok" };
	assert.deepEqual(L.jwRemoveArgv(home, row), ["/Users/me/dotfiles/scripts/jw", "rm", "ok"]);
	assert.deepEqual(L.jwNewArgv(home, "feat/x"), ["/Users/me/dotfiles/scripts/jw", "new", "feat/x"]);
	assert.deepEqual(L.focusSwitchArgv(home, "dotfiles", "feat/x"), ["/Users/me/dotfiles/scripts/focus", "switch", "dotfiles:feat/x"]);
	assert.deepEqual(L.focusStageArgv(home, "dotfiles:feat/x", "review"), ["/Users/me/dotfiles/scripts/focus", "stage", "dotfiles:feat/x", "review"]);
	assert.deepEqual(L.focusParkArgv(home, "dotfiles:feat/x"), ["/Users/me/dotfiles/scripts/focus", "park", "dotfiles:feat/x"]);
	assert.deepEqual(L.focusDropArgv(home, "dotfiles:feat/x"), ["/Users/me/dotfiles/scripts/focus", "drop", "dotfiles:feat/x"]);
	for (const argv of [L.jwRemoveArgv(home, row), L.jwNewArgv(home, "b"), L.focusDropArgv(home, "k")]) {
		assert.ok(Array.isArray(argv));
		assert.ok(!argv.includes("--yes"), "drop never passes --yes from the panel");
		assert.ok(!argv.some((a) => a === "-f" || a === "--force"), "no force flag");
	}
});

test("openBoardArgv encodes the board path into the obsidian URL", () => {
	assert.deepEqual(L.openBoardArgv("/Users/me/repos/Obsidian/Focus.md"), ["open", "obsidian://open?path=%2FUsers%2Fme%2Frepos%2FObsidian%2FFocus.md"]);
});

test("enabledActions: missing means all four; unknown names are dropped", () => {
	assert.deepEqual([...L.enabledActions(undefined)].sort(), ["board", "cleanup", "new", "open"]);
	assert.deepEqual([...L.enabledActions(["open", "bogus"])], ["open"]);
	assert.deepEqual([...L.enabledActions([])], []);
});

test("primaryAction respects enabled actions", () => {
	const on = new Set(["board", "open", "new", "cleanup"]);
	assert.equal(L.primaryAction("board", on), "board");
	assert.equal(L.primaryAction("worktree", on), "open");
	assert.equal(L.primaryAction("repo", on), "new");
	assert.equal(L.primaryAction("worktree", new Set(["board"])), null, "an action not in props.actions has no key");
});

test("validBranch rejects shapes git would refuse and keeps normal names", () => {
	assert.equal(L.validBranch("feat/x"), "feat/x");
	assert.equal(L.validBranch("  feat/x  "), "feat/x");
	assert.equal(L.validBranch(""), null);
	assert.equal(L.validBranch("-rf"), null);
	assert.equal(L.validBranch("a b"), null);
	assert.equal(L.validBranch("a..b"), null);
	assert.equal(L.validBranch("a:b"), null);
	assert.equal(L.validBranch("a\nb"), null);
});

test("attentionText lists breaches and merged rows; empty when neither", () => {
	assert.equal(L.attentionText([], 0), "");
	assert.equal(L.attentionText(["breach: Frozen holds 4 items"], 0), "1 over cap");
	assert.equal(L.attentionText([], 2), "2 merged to clean up");
	assert.equal(L.attentionText(["x"], 1), "1 over cap · 1 merged to clean up");
});

test("parseLsofCwds reads n-lines as cwds, skips other fields, drops duplicates", () => {
	const text = "p123\nfcwd\nn/r/d/.claude/worktrees/herdr-pi\np456\nfcwd\nn/r/d/x\nn/r/d/x\nf3\nn\n";
	assert.deepEqual(L.parseLsofCwds(text), ["/r/d/.claude/worktrees/herdr-pi", "/r/d/x"]);
});

test("parseLsofCwds on empty input is an empty list", () => {
	assert.deepEqual(L.parseLsofCwds(""), []);
	assert.deepEqual(L.parseLsofCwds(undefined), []);
});

test("isAgentTerminal counts agent programs and agent-status terminals, not plain shells", () => {
	assert.equal(L.isAgentTerminal({ agent: "zsh", program: { agent: false, shell: true } }), false, "a shell reports agent: zsh and is not an agent");
	assert.equal(L.isAgentTerminal({ agent: "claude", program: { agent: true } }), true);
	assert.equal(L.isAgentTerminal({ agent_status: "working", program: { agent: false } }), true);
	assert.equal(L.isAgentTerminal({}), false);
	assert.equal(L.isAgentTerminal(null), false);
});

test("cleanupRows never offers a merged managed worktree with a process cwd inside it", () => {
	const repo = "/r/d";
	const merged = { path: "/r/d/.claude/worktrees/herdr-pi", branch: "feat/herdr-pi", merged: "merged", prunable: false };
	const rows = L.decorate(L.parseWorktrees(
		"worktree /r/d\nbranch refs/heads/main\n\nworktree /r/d/.claude/worktrees/herdr-pi\nbranch refs/heads/feat/herdr-pi\n",
	), { merged: { prMerged: ["feat/herdr-pi"], gitMerged: [] }, cwds: L.parseLsofCwds("p9\nn/r/d/.claude/worktrees/herdr-pi/src\n") });
	assert.equal(rows[1].live, true, "a background process cwd makes the worktree live");
	assert.deepEqual(L.cleanupRows(rows, repo), [], "live + merged is not offered");
	assert.equal(merged.merged, "merged");
});

test("openBoardArgv percent-encodes the path, so spaces and slashes survive", () => {
	assert.deepEqual(L.openBoardArgv("/a b/Focus.md"), ["open", "obsidian://open?path=%2Fa%20b%2FFocus.md"]);
});
