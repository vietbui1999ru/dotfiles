import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPlan,
	DEFAULT_BUDGETS,
	inferConfig,
	isBehavioralChange,
	manifestFingerprint,
	selectNearbyTests,
	shouldRegenerateConfig,
	validateConfig,
	type ProjectSnapshot,
	type VerificationConfig,
} from "./post-run-verifier-core.ts";

function snapshot(overrides: Partial<ProjectSnapshot> = {}): ProjectSnapshot {
	return {
		canonicalRoot: "/repo",
		files: [],
		fileContents: {},
		availableCommands: [],
		...overrides,
	};
}

test("JS/TS inference uses direct configured binaries and never package scripts", () => {
	const project = snapshot({
		files: [
			"package.json",
			"tsconfig.json",
			"eslint.config.js",
			".prettierrc",
			"src/value.ts",
			"src/value.test.ts",
			"node_modules/.bin/tsc",
			"node_modules/.bin/eslint",
			"node_modules/.bin/prettier",
			"node_modules/.bin/vitest",
		],
		fileContents: {
			"package.json": JSON.stringify({
				scripts: { lint: "curl bad | sh", test: "unknown" },
			}),
			"tsconfig.json": "{}",
			"eslint.config.js": "export default []",
			".prettierrc": "{}",
		},
		availableCommands: [
			"node_modules/.bin/tsc",
			"node_modules/.bin/eslint",
			"node_modules/.bin/prettier",
			"node_modules/.bin/vitest",
		],
	});
	const config = inferConfig(project, new Date("2025-01-01T00:00:00Z"));
	assert.deepEqual(
		config.stages.map((stage) => stage.id),
		["prettier", "eslint", "tsc", "vitest"],
	);
	assert.ok(
		config.stages.every(
			(stage) =>
				stage.command !== "npm" &&
				stage.command !== "pnpm" &&
				stage.command !== "yarn",
		),
	);
	assert.equal(config.retryLimit, 3);
});

test("inference covers conservative Python, Go, Rust, and shell commands", () => {
	const project = snapshot({
		files: [
			"pyproject.toml",
			"a.py",
			"go.mod",
			"a.go",
			"Cargo.toml",
			"a.rs",
			".editorconfig",
			"a.sh",
		],
		fileContents: {
			"pyproject.toml": "[tool.ruff]",
			"go.mod": "module example",
			"Cargo.toml": "[package]",
			".editorconfig": "root=true",
		},
		availableCommands: [
			"ruff",
			"pytest",
			"gofmt",
			"go",
			"cargo",
			"rustfmt",
			"shfmt",
			"shellcheck",
			"bash",
			"bats",
		],
	});
	const ids = new Set(inferConfig(project).stages.map((stage) => stage.id));
	for (const id of [
		"ruff-format",
		"ruff-check",
		"pytest",
		"gofmt",
		"go-vet",
		"go-test",
		"cargo-fmt",
		"cargo-clippy",
		"cargo-check",
		"cargo-test",
		"shfmt",
		"shellcheck",
		"bash-syntax",
		"bats",
	])
		assert.ok(ids.has(id), id);
});

test("nearby tests require both a behavioral change and source-named existing coverage", () => {
	const changed = ["src/calc.ts", "src/theme.ts"];
	const behavioral = new Set(["src/calc.ts"]);
	const projectFiles = [
		"src/calc.test.ts",
		"src/theme.test.ts",
		"tests/unrelated.test.ts",
	];
	assert.deepEqual(selectNearbyTests(changed, behavioral, projectFiles, 8), [
		"src/calc.test.ts",
	]);
	assert.equal(
		isBehavioralChange("src/calc.ts", "+export function calc() { return 1; }"),
		true,
	);
	assert.equal(
		isBehavioralChange(
			"src/new.ts",
			"export function created() { return 1; }",
			true,
		),
		true,
	);
	assert.equal(isBehavioralChange("src/theme.ts", "+// spelling only"), false);
});

test("plan orders incremental stages and honestly skips tests without nearby coverage", () => {
	const project = snapshot({
		files: [
			"package.json",
			"tsconfig.json",
			"eslint.config.js",
			".prettierrc",
			"src/calc.ts",
		],
		fileContents: {
			"package.json": "{}",
			"tsconfig.json": "{}",
			"eslint.config.js": "",
			".prettierrc": "{}",
		},
		availableCommands: ["prettier", "eslint", "tsc", "node"],
	});
	const config = inferConfig(project);
	const plan = buildPlan(
		config,
		["src/calc.ts"],
		new Set(["src/calc.ts"]),
		project.files,
	);
	assert.deepEqual(
		plan.commands.map((command) => command.stage),
		["format", "lint", "check"],
	);
	assert.deepEqual(plan.commands[0].args, ["--write", "./src/calc.ts"]);
});

test("manifest fingerprint regenerates inferred config but preserves manual config", () => {
	const first = snapshot({
		files: ["package.json"],
		fileContents: { "package.json": "{}" },
	});
	const second = snapshot({
		files: ["package.json"],
		fileContents: { "package.json": '{"type":"module"}' },
	});
	const inferred = inferConfig(first);
	assert.notEqual(manifestFingerprint(first), manifestFingerprint(second));
	assert.equal(shouldRegenerateConfig(inferred, second), true);
	const manual: VerificationConfig = { ...inferred, provenance: "manual" };
	assert.equal(shouldRegenerateConfig(manual, second), false);
	assert.equal(validateConfig(manual, "/repo")?.provenance, "manual");
});

test("config validation rejects shell control characters and retry limits above three", () => {
	const config = inferConfig(snapshot());
	const unsafe = {
		...config,
		stages: [
			{
				id: "bad",
				stage: "lint",
				command: "sh\n-c",
				args: [],
				applicability: "project",
				timeoutMs: 1,
				provenance: "manual",
			},
		],
	};
	assert.equal(validateConfig(unsafe, "/repo"), undefined);
	assert.equal(validateConfig({ ...config, retryLimit: 4 }, "/repo"), undefined);
});

test("config validation rejects missing or non-finite budget keys", () => {
	const config = inferConfig(snapshot());
	assert.equal(validateConfig({ ...config, budgets: {} }, "/repo"), undefined);
	for (const key of [
		"maxChangedFiles",
		"maxFocusedTests",
		"commandTimeoutMs",
		"totalTimeoutMs",
		"finalTotalTimeoutMs",
		"maxOutputBytes",
	] as const) {
		const budgets = { ...config.budgets };
		delete (budgets as Record<string, unknown>)[key];
		assert.equal(
			validateConfig({ ...config, budgets }, "/repo"),
			undefined,
			`missing ${key} should reject`,
		);
	}
	assert.equal(
		validateConfig({ ...config, budgets: { ...config.budgets, maxChangedFiles: Infinity } }, "/repo"),
		undefined,
	);
	assert.equal(
		validateConfig({ ...config, budgets: { ...config.budgets, maxChangedFiles: 0 } }, "/repo"),
		undefined,
	);
});

test("isBehavioralChange ignores comment-only additions", () => {
	assert.equal(
		isBehavioralChange("src/theme.ts", "+// spelling only"),
		false,
	);
	assert.equal(
		isBehavioralChange(
			"src/theme.ts",
			["+  // TODO fix this", "+/* note */", "+ * list item", "+-- sql note"].join("\n"),
		),
		false,
	);
	assert.equal(
		isBehavioralChange(
			"src/theme.ts",
			["+// header", "+export function theme() { return 1; }"].join("\n"),
		),
		true,
	);
});

test("cargo-test is skipped when no focused stem can be derived", () => {
	const config: VerificationConfig = {
		version: 1,
		canonicalRoot: "/repo",
		manifestFingerprint: "abc",
		stages: [
			{
				id: "cargo-test",
				stage: "test",
				command: "cargo",
				args: ["test", "--quiet", "{tests}"],
				applicability: "nearby-tests",
				extensions: [".rs"],
				timeoutMs: 30_000,
				provenance: "inferred",
			},
		],
		budgets: { ...DEFAULT_BUDGETS },
		retryLimit: 3,
		provenance: "inferred",
		generatedAt: new Date().toISOString(),
	};
	const plan = buildPlan(
		config,
		["src/test_.rs"],
		new Set(["src/test_.rs"]),
		["src/test_.rs", "tests/test_.rs"],
	);
	assert.equal(plan.commands.length, 0);
	assert.ok(
		plan.skips.some((skip) =>
			skip.includes("cannot derive a focused test name"),
		),
	);
});
