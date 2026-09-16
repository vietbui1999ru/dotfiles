import assert from "node:assert/strict";
import test from "node:test";
import {
	autoApplyEnabledFromEnv,
	DEFAULT_AUTO_REVIEW_POLICY,
	evaluateAutoReview,
} from "./review-auto-policy.ts";

test("permits a small ordinary source batch to proceed to verification", () => {
	assert.deepEqual(
		evaluateAutoReview([
			{ path: "src/widget.ts", action: "modify", changedLoc: 32 },
			{ path: "test/widget.test.ts", action: "modify", changedLoc: 18 },
		]),
		{ eligible: true, reasons: [] },
	);
});

test("auto-apply is disabled unless explicitly opted in with exactly 1", () => {
	assert.equal(autoApplyEnabledFromEnv({}), false);
	assert.equal(autoApplyEnabledFromEnv({ PI_REVIEW_GATE_AUTO_APPLY: "0" }), false);
	assert.equal(autoApplyEnabledFromEnv({ PI_REVIEW_GATE_AUTO_APPLY: "true" }), false);
	assert.equal(autoApplyEnabledFromEnv({ PI_REVIEW_GATE_AUTO_APPLY: "yes" }), false);
	assert.equal(autoApplyEnabledFromEnv({ PI_REVIEW_GATE_AUTO_APPLY: "1" }), true);
});

test("blocks dependency lockfiles and package manifests", () => {
	const decision = evaluateAutoReview([
		{ path: "package-lock.json", action: "modify", changedLoc: 8 },
		{ path: "pnpm-lock.yaml", action: "modify", changedLoc: 4 },
		{ path: "package.json", action: "modify", changedLoc: 4 },
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /dependency lockfile|verification config/);
	assert.match(decision.reasons.join("\n"), /package\.json is a verification config/);
});

test("blocks a batch that exceeds conservative LOC limits", () => {
	const decision = evaluateAutoReview([
		{ path: "src/large.ts", action: "modify", changedLoc: 101 },
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /limit 100/);
});

test("blocks every verified secrets and credentials bypass", () => {
	for (const path of [
		".env.local",
		".env.production",
		"config/.env.local",
		"secrets.json",
		"credentials.json",
		"client-secrets.ts",
	]) {
		const decision = evaluateAutoReview([
			{ path, action: "modify", changedLoc: 2 },
		]);
		assert.equal(
			decision.eligible,
			false,
			`${path} must require manual review`,
		);
		assert.match(decision.reasons.join("\n"), /secrets file/);
	}
});

test("blocks auth and security paths even with source extensions", () => {
	for (const path of ["authentication/x.ts", "src/auth.ts", "auth-utils.ts", "security/hardening.rs"]) {
		const decision = evaluateAutoReview([
			{ path, action: "modify", changedLoc: 4 },
		]);
		assert.equal(
			decision.eligible,
			false,
			`${path} must require manual review`,
		);
		assert.match(decision.reasons.join("\n"), /protected path/);
	}
});

test("blocks CI, container, build, hook, and infrastructure files", () => {
	for (const path of [
		".github/actions/a.yml",
		".github/workflows/ci.yml",
		".gitlab-ci.yml",
		"Dockerfile",
		"docker-compose.yml",
		"Makefile",
		".husky/pre-commit",
		"scripts/pre-commit.sh",
		".npmrc",
		"main.tf",
		"infrastructure/x.tf",
		"bin/deploy.sh",
	]) {
		const decision = evaluateAutoReview([
			{ path, action: "modify", changedLoc: 4 },
		]);
		assert.equal(
			decision.eligible,
			false,
			`${path} must require manual review`,
		);
	}
});

test("blocks verifier and build config names including source-extension configs", () => {
	for (const path of [
		"tsconfig.json",
		"biome.json",
		"eslint.config.js",
		"prettier.config.cjs",
		"pyproject.toml",
		"go.mod",
		"Cargo.toml",
	]) {
		const decision = evaluateAutoReview([
			{ path, action: "modify", changedLoc: 4 },
		]);
		assert.equal(
			decision.eligible,
			false,
			`${path} must require manual review`,
		);
		assert.match(decision.reasons.join("\n"), /verification config/);
	}
});

test("blocks non-source files by default (deny by default)", () => {
	for (const path of ["README.md", "logo.png", "data.csv", "notes.txt"]) {
		const decision = evaluateAutoReview([
			{ path, action: "modify", changedLoc: 2 },
		]);
		assert.equal(
			decision.eligible,
			false,
			`${path} must require manual review`,
		);
		assert.match(decision.reasons.join("\n"), /non-source file/);
	}
});

test("a rename out of a protected path is blocked via its old path", () => {
	const decision = evaluateAutoReview([
		{
			path: "session.ts",
			oldPath: "auth/session.ts",
			action: "rename",
			changedLoc: 5,
		},
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /auth\/session\.ts is a protected path/);
});

test("a rename into a protected path is blocked via its new path", () => {
	const decision = evaluateAutoReview([
		{
			path: "auth/session.ts",
			oldPath: "session.ts",
			action: "rename",
			changedLoc: 5,
		},
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /protected path/);
});

test("a delete of a protected file is blocked via its old path", () => {
	const decision = evaluateAutoReview([
		{ path: "src/auth.ts", action: "delete", changedLoc: 0 },
	]);
	assert.equal(decision.eligible, false);
	assert.match(decision.reasons.join("\n"), /protected path/);
});

test("binary files are never eligible for auto-apply", () => {
	const decision = evaluateAutoReview([
		{ path: "assets/logo.png", action: "modify", changedLoc: 0, binary: true },
	]);
	assert.equal(decision.eligible, false);
	assert.match(
		decision.reasons.join("\n"),
		/binary file; manual review required/,
	);
});

test("an ordinary source rename stays eligible", () => {
	assert.deepEqual(
		evaluateAutoReview([
			{
				path: "src/session.ts",
				oldPath: "src/legacy-session.ts",
				action: "rename",
				changedLoc: 5,
			},
		]),
		{ eligible: true, reasons: [] },
	);
});

test("session auto-apply cap blocks cumulative unreviewed LOC", () => {
	const batch = (changedLocPerFile: number, filesCount: number) =>
		Array.from({ length: filesCount }, (_, index) => ({
			path: `src/widget${index}.ts`,
			action: "modify" as const,
			changedLoc: changedLocPerFile,
		}));
	assert.equal(evaluateAutoReview(batch(75, 4)).eligible, true);
	const second = evaluateAutoReview(
		batch(75, 4),
		DEFAULT_AUTO_REVIEW_POLICY,
		350,
	);
	assert.equal(second.eligible, false);
	assert.match(second.reasons.join("\n"), /session auto-apply cap/);
	// Under the cap is still eligible.
	assert.equal(
		evaluateAutoReview(batch(50, 2), DEFAULT_AUTO_REVIEW_POLICY, 350)
			.eligible,
		true,
	);
});
