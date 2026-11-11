// Run: node --test scripts/pi-sandbox-policy.test.mjs
//
// pi-sandbox-policy turns Claude's sandbox settings into Pi's Seatbelt deny block. These tests
// only read its output, so they run anywhere, including inside Claude's own sandbox.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const POLICY = join(dirname(fileURLToPath(import.meta.url)), "pi-sandbox-policy");
const DENY_WRITE = ["~/.local/state/ac-run", "~/repos/Obsidian/Focus.md", "**/.pi/agent-review/decisions", "/abs/dir/**"];

function run(settings) {
	const dir = mkdtempSync(join(tmpdir(), "pi-policy-"));
	const file = join(dir, "settings.json");
	if (settings !== undefined) writeFileSync(file, typeof settings === "string" ? settings : JSON.stringify(settings));
	return spawnSync(POLICY, [file, "/wt", "/repo/.git", "/home/u"], { encoding: "utf8" });
}

test("every denyWrite entry appears in the generated profile", () => {
	const result = run({ sandbox: { filesystem: { denyWrite: DENY_WRITE, denyRead: ["~/secrets"] } } });
	assert.equal(result.status, 0, result.stderr);
	const out = result.stdout;
	assert.match(out, /\(subpath "\/home\/u\/\.local\/state\/ac-run"\)/);
	assert.match(out, /\(subpath "\/home\/u\/repos\/Obsidian\/Focus\.md"\)/);
	assert.ok(out.includes('(regex #"^.*/\\.pi/agent-review/decisions(/.*)?$")'), out);
	assert.match(out, /\(subpath "\/abs\/dir"\)/);
	assert.match(out, /\(deny file-read\*\n {2}\(subpath "\/home\/u\/secrets"\)\)/);
});

test("Claude's built-in protections and the control sockets are added", () => {
	const out = run({ sandbox: { filesystem: { denyWrite: DENY_WRITE } } }).stdout;
	for (const filter of ['(literal "/wt/.claude/settings.json")', '(literal "/wt/.claude/settings.local.json")',
		'(subpath "/wt/.claude/hooks")', '(subpath "/wt/.claude/skills")', '(subpath "/repo/.git/hooks")',
		'(literal "/repo/.git/config")', '(remote unix-socket (subpath "/home/u/Library/Application Support/pueue"))',
		'(remote unix-socket (subpath "/home/u/.local/state/herdr-core"))', '(remote unix-socket (subpath "/home/u/.config/herdr-app"))']) {
		assert.ok(out.includes(filter), `missing ${filter}`);
	}
	assert.ok(!out.includes("deny file-read*"), "no read block without denyRead");
});

test("missing, unparsable or sandbox-less settings fail closed", () => {
	for (const settings of [undefined, "{not json", {}, { sandbox: {} }, { sandbox: { filesystem: { denyWrite: [] } } }]) {
		const result = run(settings);
		assert.equal(result.status, 1, JSON.stringify(settings));
		assert.equal(result.stdout, "", "nothing printed on refusal");
		assert.match(result.stderr, /^pi-sandbox-policy: /);
	}
});

test("unknown path forms and quote characters fail closed", () => {
	for (const entry of ["relative/dir", "~/a*b", "**/a*b", '~/has"quote', "~/back\\slash"]) {
		const result = run({ sandbox: { filesystem: { denyWrite: [entry] } } });
		assert.equal(result.status, 1, entry);
	}
});
