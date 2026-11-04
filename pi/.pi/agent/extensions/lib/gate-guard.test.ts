// Run: bun test ./pi/.pi/agent/extensions/lib/gate-guard.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { gateBlocked } from "./gate-guard-core.ts";

const HOME = "/home/tester";
const CWD = "/home/tester/dotfiles";
const call = (toolName: string, input: Record<string, unknown>) => gateBlocked({ toolName, input }, HOME, CWD);

test("refuses approve calls and bash that names approval records", () => {
	for (const command of [
		"~/dotfiles/scripts/agent-review approve abc123",
		"python3 scripts/agent-review approve abc",
		'bash -c "scripts/spec approve SPEC.md"',
		"$HOME/dotfiles/scripts/spec  approve SPEC.md",
		"echo '{}' > ~/.local/state/ac-run/x.json",
		"cp d.json .pi/agent-review/decisions/run.json",
	]) assert.equal(call("bash", { command }), true, command);
});

test("leaves other gate subcommands and plain work alone", () => {
	for (const command of ["scripts/agent-review list", "scripts/spec status SPEC.md", "scripts/spec check SPEC.md", "rg approved docs"])
		assert.equal(call("bash", { command }), false, command);
});

test("refuses writes and edits to approval records and guard files", () => {
	for (const path of [
		"~/.local/state/ac-run/abc.json",
		".pi/agent-review/decisions/run.json",
		"/home/tester/dotfiles/scripts/spec",
		"/home/tester/dotfiles/.claude/worktrees/wt/scripts/agent-review",
		"claude/.claude/settings.json",
		"claude/.claude/hooks/enforce-bash-safety.sh",
		"pi/.pi/agent/extensions/secrets-guard.ts",
		"pi/.pi/agent/extensions/lib/gate-guard-core.ts",
		"codex-guardrails-plugin/hooks/block-dangerous-shell.sh",
	]) {
		assert.equal(call("write", { path }), true, path);
		assert.equal(call("edit", { path }), true, path);
	}
});

test("reads and unrelated files stay open", () => {
	assert.equal(call("read", { path: "scripts/spec" }), false);
	assert.equal(call("edit", { path: "scripts/spec-helper.md" }), false);
	assert.equal(call("write", { path: "/home/tester/other/scripts/spec" }), false);
	assert.equal(call("edit", { path: "docs/workflows/agent-review.md" }), false);
});
