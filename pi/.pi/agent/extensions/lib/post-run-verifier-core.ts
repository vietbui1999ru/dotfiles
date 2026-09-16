import { createHash } from "node:crypto";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";

export const CONFIG_VERSION = 1;
export const DEFAULT_BUDGETS: VerificationBudgets = {
	maxChangedFiles: 40,
	maxFocusedTests: 8,
	commandTimeoutMs: 30_000,
	totalTimeoutMs: 120_000,
	finalTotalTimeoutMs: 180_000,
	maxOutputBytes: 12_000,
};

export type StageName = "format" | "lint" | "check" | "test";
export type Applicability =
	| "changed-files"
	| "project"
	| "nearby-tests"
	| "changed-packages";

export interface VerificationBudgets {
	maxChangedFiles: number;
	maxFocusedTests: number;
	commandTimeoutMs: number;
	totalTimeoutMs: number;
	finalTotalTimeoutMs: number;
	maxOutputBytes: number;
}

export interface VerificationCommand {
	id: string;
	stage: StageName;
	command: string;
	args: string[];
	applicability: Applicability;
	extensions?: string[];
	timeoutMs: number;
	provenance: "inferred" | "manual" | "repo-override";
}

export interface VerificationConfig {
	version: 1;
	canonicalRoot: string;
	manifestFingerprint: string;
	stages: VerificationCommand[];
	budgets: VerificationBudgets;
	retryLimit: number;
	provenance: "inferred" | "manual" | "repo-override";
	generatedAt: string;
}

export interface ProjectSnapshot {
	canonicalRoot: string;
	files: string[];
	fileContents: Record<string, string>;
	availableCommands: string[];
	scanTruncated?: boolean;
}

export interface PlannedCommand extends VerificationCommand {
	args: string[];
	selectedFiles: string[];
}

export interface VerificationPlan {
	commands: PlannedCommand[];
	skips: string[];
	changedFiles: string[];
	focusedTests: string[];
}

export const MANIFEST_AND_CONFIG_NAMES = new Set([
	"package.json",
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"tsconfig.json",
	"jsconfig.json",
	"biome.json",
	"biome.jsonc",
	"eslint.config.js",
	"eslint.config.cjs",
	"eslint.config.mjs",
	"eslint.config.ts",
	".eslintrc",
	".eslintrc.json",
	".prettierrc",
	".prettierrc.json",
	"prettier.config.js",
	"prettier.config.cjs",
	"pyproject.toml",
	"ruff.toml",
	".ruff.toml",
	"mypy.ini",
	".mypy.ini",
	"pyrightconfig.json",
	"setup.cfg",
	"pytest.ini",
	"go.mod",
	"go.work",
	"Cargo.toml",
	"Cargo.lock",
	"rustfmt.toml",
	".rustfmt.toml",
	".shellcheckrc",
	".editorconfig",
	".shfmt",
]);

export const CODE_EXTENSIONS = new Set([
	".js",
	".jsx",
	".mjs",
	".cjs",
	".ts",
	".tsx",
	".mts",
	".cts",
	".py",
	".go",
	".rs",
	".sh",
	".bash",
	".zsh",
]);

function normalized(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function hasFile(snapshot: ProjectSnapshot, ...names: string[]): boolean {
	const files = new Set(snapshot.files.map(normalized));
	return names.some(
		(name) =>
			files.has(name) || [...files].some((file) => file.endsWith(`/${name}`)),
	);
}

function commandAvailable(snapshot: ProjectSnapshot, command: string): boolean {
	return snapshot.availableCommands.includes(command);
}

function localCommand(
	snapshot: ProjectSnapshot,
	name: string,
): string | undefined {
	const relativeBinary = `node_modules/.bin/${name}`;
	if (
		snapshot.files.map(normalized).includes(relativeBinary) ||
		commandAvailable(snapshot, relativeBinary)
	) {
		return relativeBinary;
	}
	return commandAvailable(snapshot, name) ? name : undefined;
}

function pushCommand(
	commands: VerificationCommand[],
	partial: Omit<VerificationCommand, "timeoutMs" | "provenance">,
): void {
	commands.push({
		...partial,
		timeoutMs: DEFAULT_BUDGETS.commandTimeoutMs,
		provenance: "inferred",
	});
}

/** Stable fingerprint of only files that can change inferred verification behavior. */
export function manifestFingerprint(snapshot: ProjectSnapshot): string {
	const hash = createHash("sha256");
	for (const path of snapshot.files
		.map(normalized)
		.filter((file) => MANIFEST_AND_CONFIG_NAMES.has(basename(file)))
		.sort()) {
		hash.update(path);
		hash.update("\0");
		hash.update(snapshot.fileContents[path] ?? "");
		hash.update("\0");
	}
	return hash.digest("hex").slice(0, 24);
}

/** Infer direct tool invocations only. Package scripts are never guessed. */
export function inferConfig(
	snapshot: ProjectSnapshot,
	now = new Date(),
): VerificationConfig {
	const stages: VerificationCommand[] = [];
	const files = snapshot.files.map(normalized);
	const hasJs = files.some((file) =>
		[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"].includes(
			extname(file),
		),
	);
	const hasPython = files.some((file) => extname(file) === ".py");
	const hasGo =
		hasFile(snapshot, "go.mod") || files.some((file) => extname(file) === ".go");
	const hasRust =
		hasFile(snapshot, "Cargo.toml") ||
		files.some((file) => extname(file) === ".rs");
	const hasShell = files.some((file) =>
		[".sh", ".bash", ".zsh"].includes(extname(file)),
	);

	if (hasJs) {
		const biome = localCommand(snapshot, "biome");
		const prettier = localCommand(snapshot, "prettier");
		const eslint = localCommand(snapshot, "eslint");
		if (biome && hasFile(snapshot, "biome.json", "biome.jsonc")) {
			pushCommand(stages, {
				id: "biome-format",
				stage: "format",
				command: biome,
				args: ["format", "--write", "{files}"],
				applicability: "changed-files",
				extensions: [
					".js",
					".jsx",
					".mjs",
					".cjs",
					".ts",
					".tsx",
					".mts",
					".cts",
					".json",
					".css",
				],
			});
			pushCommand(stages, {
				id: "biome-lint",
				stage: "lint",
				command: biome,
				args: ["lint", "{files}"],
				applicability: "changed-files",
				extensions: [
					".js",
					".jsx",
					".mjs",
					".cjs",
					".ts",
					".tsx",
					".mts",
					".cts",
					".json",
					".css",
				],
			});
		} else if (
			prettier &&
			hasFile(
				snapshot,
				".prettierrc",
				".prettierrc.json",
				"prettier.config.js",
				"prettier.config.cjs",
			)
		) {
			pushCommand(stages, {
				id: "prettier",
				stage: "format",
				command: prettier,
				args: ["--write", "{files}"],
				applicability: "changed-files",
				extensions: [
					".js",
					".jsx",
					".mjs",
					".cjs",
					".ts",
					".tsx",
					".mts",
					".cts",
					".json",
					".css",
					".md",
					".yaml",
					".yml",
				],
			});
		}
		if (
			eslint &&
			hasFile(
				snapshot,
				"eslint.config.js",
				"eslint.config.cjs",
				"eslint.config.mjs",
				"eslint.config.ts",
				".eslintrc",
				".eslintrc.json",
			)
		) {
			pushCommand(stages, {
				id: "eslint",
				stage: "lint",
				command: eslint,
				args: ["{files}"],
				applicability: "changed-files",
				extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
			});
		}
		const tsc = localCommand(snapshot, "tsc");
		if (tsc && hasFile(snapshot, "tsconfig.json")) {
			pushCommand(stages, {
				id: "tsc",
				stage: "check",
				command: tsc,
				args: ["--noEmit", "--pretty", "false"],
				applicability: "project",
				extensions: [".ts", ".tsx", ".mts", ".cts"],
			});
		}
		const vitest = localCommand(snapshot, "vitest");
		const jest = localCommand(snapshot, "jest");
		if (vitest) {
			pushCommand(stages, {
				id: "vitest",
				stage: "test",
				command: vitest,
				args: ["run", "{tests}"],
				applicability: "nearby-tests",
				extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
			});
		} else if (jest) {
			pushCommand(stages, {
				id: "jest",
				stage: "test",
				command: jest,
				args: ["--runInBand", "{tests}"],
				applicability: "nearby-tests",
				extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts"],
			});
		} else if (commandAvailable(snapshot, "node")) {
			pushCommand(stages, {
				id: "node-test",
				stage: "test",
				command: "node",
				args: ["--test", "{tests}"],
				applicability: "nearby-tests",
				extensions: [".js", ".mjs", ".cjs"],
			});
		}
	}

	if (hasPython) {
		const ruff = localCommand(snapshot, "ruff");
		const black = localCommand(snapshot, "black");
		if (ruff && hasFile(snapshot, "pyproject.toml", "ruff.toml", ".ruff.toml")) {
			pushCommand(stages, {
				id: "ruff-format",
				stage: "format",
				command: ruff,
				args: ["format", "{files}"],
				applicability: "changed-files",
				extensions: [".py"],
			});
			pushCommand(stages, {
				id: "ruff-check",
				stage: "lint",
				command: ruff,
				args: ["check", "{files}"],
				applicability: "changed-files",
				extensions: [".py"],
			});
		} else if (black && hasFile(snapshot, "pyproject.toml")) {
			pushCommand(stages, {
				id: "black",
				stage: "format",
				command: black,
				args: ["{files}"],
				applicability: "changed-files",
				extensions: [".py"],
			});
		}
		const pyright = localCommand(snapshot, "pyright");
		const mypy = localCommand(snapshot, "mypy");
		if (pyright && hasFile(snapshot, "pyrightconfig.json")) {
			pushCommand(stages, {
				id: "pyright",
				stage: "check",
				command: pyright,
				args: ["{files}"],
				applicability: "changed-files",
				extensions: [".py"],
			});
		} else if (
			mypy &&
			hasFile(snapshot, "mypy.ini", ".mypy.ini", "pyproject.toml", "setup.cfg")
		) {
			pushCommand(stages, {
				id: "mypy",
				stage: "check",
				command: mypy,
				args: ["{files}"],
				applicability: "changed-files",
				extensions: [".py"],
			});
		}
		const pytest = localCommand(snapshot, "pytest");
		if (pytest)
			pushCommand(stages, {
				id: "pytest",
				stage: "test",
				command: pytest,
				args: ["-q", "{tests}"],
				applicability: "nearby-tests",
				extensions: [".py"],
			});
	}

	if (hasGo) {
		if (commandAvailable(snapshot, "gofmt"))
			pushCommand(stages, {
				id: "gofmt",
				stage: "format",
				command: "gofmt",
				args: ["-w", "{files}"],
				applicability: "changed-files",
				extensions: [".go"],
			});
		if (commandAvailable(snapshot, "go") && hasFile(snapshot, "go.mod")) {
			pushCommand(stages, {
				id: "go-vet",
				stage: "check",
				command: "go",
				args: ["vet", "{packages}"],
				applicability: "changed-packages",
				extensions: [".go"],
			});
			pushCommand(stages, {
				id: "go-test",
				stage: "test",
				command: "go",
				args: ["test", "{packages}"],
				applicability: "nearby-tests",
				extensions: [".go"],
			});
		}
	}

	if (
		hasRust &&
		commandAvailable(snapshot, "cargo") &&
		hasFile(snapshot, "Cargo.toml")
	) {
		if (commandAvailable(snapshot, "rustfmt"))
			pushCommand(stages, {
				id: "cargo-fmt",
				stage: "format",
				command: "cargo",
				args: ["fmt", "--", "{files}"],
				applicability: "changed-files",
				extensions: [".rs"],
			});
		pushCommand(stages, {
			id: "cargo-clippy",
			stage: "lint",
			command: "cargo",
			args: ["clippy", "--quiet", "--message-format", "short", "--no-deps"],
			applicability: "project",
			extensions: [".rs"],
		});
		pushCommand(stages, {
			id: "cargo-check",
			stage: "check",
			command: "cargo",
			args: ["check", "--quiet", "--message-format", "short"],
			applicability: "project",
			extensions: [".rs"],
		});
		pushCommand(stages, {
			id: "cargo-test",
			stage: "test",
			command: "cargo",
			args: ["test", "--quiet", "{tests}"],
			applicability: "nearby-tests",
			extensions: [".rs"],
		});
	}

	if (hasShell) {
		if (
			commandAvailable(snapshot, "shfmt") &&
			hasFile(snapshot, ".editorconfig", ".shfmt")
		)
			pushCommand(stages, {
				id: "shfmt",
				stage: "format",
				command: "shfmt",
				args: ["-w", "{files}"],
				applicability: "changed-files",
				extensions: [".sh", ".bash", ".zsh"],
			});
		if (commandAvailable(snapshot, "shellcheck"))
			pushCommand(stages, {
				id: "shellcheck",
				stage: "lint",
				command: "shellcheck",
				args: ["{files}"],
				applicability: "changed-files",
				extensions: [".sh", ".bash", ".zsh"],
			});
		if (commandAvailable(snapshot, "bash"))
			pushCommand(stages, {
				id: "bash-syntax",
				stage: "check",
				command: "bash",
				args: ["-n", "{files}"],
				applicability: "changed-files",
				extensions: [".sh", ".bash"],
			});
		if (commandAvailable(snapshot, "bats"))
			pushCommand(stages, {
				id: "bats",
				stage: "test",
				command: "bats",
				args: ["{tests}"],
				applicability: "nearby-tests",
				extensions: [".sh", ".bash", ".zsh"],
			});
	}

	return {
		version: CONFIG_VERSION,
		canonicalRoot: snapshot.canonicalRoot,
		manifestFingerprint: manifestFingerprint(snapshot),
		stages,
		budgets: { ...DEFAULT_BUDGETS },
		retryLimit: 3,
		provenance: "inferred",
		generatedAt: now.toISOString(),
	};
}

export function shouldRegenerateConfig(
	config: VerificationConfig,
	snapshot: ProjectSnapshot,
): boolean {
	return (
		config.provenance === "inferred" &&
		(config.canonicalRoot !== snapshot.canonicalRoot ||
			config.manifestFingerprint !== manifestFingerprint(snapshot))
	);
}

export function isBehavioralChange(
	path: string,
	diff: string,
	isNewFile = false,
): boolean {
	if (!CODE_EXTENSIONS.has(extname(path))) return false;
	const candidate = normalized(path);
	if (
		/(^|\/)(test|tests|__tests__|fixtures?|spec)\//.test(candidate) ||
		/\.(test|spec)\.[^.]+$|_test\.go$|(^|\/)test_[^/]+\.py$|\.bats$/.test(
			candidate,
		)
	)
		return false;
	const commentMarkers = ["//", "#", "/*", "*", "--"];
	const meaningful = diff
		.split("\n")
		.filter((line) => /^[+-](?![+-])/.test(line))
		.map((line) => line.slice(1))
		.filter(
			(line) =>
				!commentMarkers.some((marker) => line.trimStart().startsWith(marker)),
		);
	const source =
		isNewFile && meaningful.length === 0 ? diff : meaningful.join("\n");
	if (!source.trim()) return false;
	return /\b(return|yield|throw|print|echo|printf|export|func|function|class|def)\b|=>|\bif\s*\(|\bcase\b|\bmatch\b/.test(
		source,
	);
}

function testStem(path: string): string {
	return basename(path, extname(path))
		.replace(/\.(test|spec)$/, "")
		.replace(/^test_/, "")
		.replace(/_test$/, "");
}

/** Select only already-existing tests whose name/directory is close to a behavioral change. */
export function selectNearbyTests(
	changedFiles: string[],
	behavioralFiles: Set<string>,
	projectFiles: string[],
	maxTests: number,
): string[] {
	const tests = projectFiles
		.map(normalized)
		.filter(
			(path) =>
				/(^|\/)(__tests__|tests?|spec)\//.test(path) ||
				/\.(test|spec)\.[^.]+$/.test(path) ||
				/(^|\/)test_[^/]+\.py$/.test(path) ||
				/_test\.go$/.test(path) ||
				/\.bats$/.test(path),
		);
	const selected = new Set<string>();
	for (const changed of changedFiles.map(normalized)) {
		if (!behavioralFiles.has(changed)) continue;
		const stem = testStem(changed);
		const changedDir = dirname(changed);
		for (const test of tests) {
			const sameStem = testStem(test) === stem;
			const nearDir =
				dirname(test) === changedDir ||
				dirname(test).startsWith(`${changedDir}/`) ||
				changedDir.startsWith(`${dirname(test)}/`);
			// A source-named test in a conventional separate tests/ tree is nearby
			// coverage even when its directory does not mirror src/ exactly.
			if (sameStem && (nearDir || /(^|\/)(__tests__|tests?|spec)\//.test(test)))
				selected.add(test);
			if (selected.size >= maxTests) return [...selected];
		}
	}
	return [...selected];
}

function expandArgs(args: string[], replacement: string[]): string[] {
	return args.flatMap((arg) =>
		arg === "{files}" || arg === "{tests}" || arg === "{packages}"
			? replacement.map((path) =>
					path.startsWith("./") ? path : `./${path}`,
				)
			: [arg],
	);
}

export function buildPlan(
	config: VerificationConfig,
	changedFilesInput: string[],
	behavioralFiles: Set<string>,
	projectFiles: string[],
): VerificationPlan {
	const skips: string[] = [];
	const changedFiles = [...new Set(changedFilesInput.map(normalized))].slice(
		0,
		config.budgets.maxChangedFiles,
	);
	if (changedFilesInput.length > changedFiles.length)
		skips.push(
			`changed-file budget: ${changedFilesInput.length - changedFiles.length} file(s) omitted`,
		);
	const focusedTests = selectNearbyTests(
		changedFiles,
		behavioralFiles,
		projectFiles,
		config.budgets.maxFocusedTests,
	);
	const commands: PlannedCommand[] = [];

	for (const item of [...config.stages].sort(
		(a, b) =>
			["format", "lint", "check", "test"].indexOf(a.stage) -
			["format", "lint", "check", "test"].indexOf(b.stage),
	)) {
		const matching = changedFiles.filter(
			(path) => !item.extensions || item.extensions.includes(extname(path)),
		);
		if (item.applicability === "changed-files") {
			if (!matching.length) {
				skips.push(`${item.id}: no applicable changed files`);
				continue;
			}
			commands.push({
				...item,
				args: expandArgs(item.args, matching),
				selectedFiles: matching,
			});
		} else if (item.applicability === "project") {
			if (!matching.length) {
				skips.push(`${item.id}: no applicable changed files`);
				continue;
			}
			commands.push({ ...item, args: [...item.args], selectedFiles: matching });
		} else if (item.applicability === "changed-packages") {
			if (!matching.length) {
				skips.push(`${item.id}: no applicable changed files`);
				continue;
			}
			const packages = [
				...new Set(
					matching.map((path) =>
						dirname(path) === "." ? "." : `./${dirname(path)}`,
					),
				),
			];
			commands.push({
				...item,
				args: expandArgs(item.args, packages),
				selectedFiles: matching,
			});
		} else {
			if (!matching.some((path) => behavioralFiles.has(path))) {
				skips.push(`${item.id}: no changed behavioral contract`);
				continue;
			}
			const matchingTests = focusedTests.filter(
				(path) => !item.extensions || item.extensions.includes(extname(path)),
			);
			if (!matchingTests.length) {
				skips.push(`${item.id}: no nearby existing coverage`);
				continue;
			}
			if (item.id === "go-test") {
				const packages = [
					...new Set(
						matchingTests.map((path) =>
							dirname(path) === "." ? "." : `./${dirname(path)}`,
						),
					),
				];
				commands.push({
					...item,
					args: expandArgs(item.args, packages),
					selectedFiles: matchingTests,
				});
		} else if (item.id === "cargo-test") {
			const stem = testStem(matchingTests[0]);
			if (!stem) {
				skips.push(
					`${item.id}: cannot derive a focused test name from ${matchingTests[0]}`,
				);
				continue;
			}
			commands.push({
				...item,
				args: expandArgs(item.args, [stem]),
				selectedFiles: [matchingTests[0]],
			});
		} else {
				commands.push({
					...item,
					args: expandArgs(item.args, matchingTests),
					selectedFiles: matchingTests,
				});
			}
		}
	}
	return { commands, skips, changedFiles, focusedTests };
}

export function configKey(canonicalRoot: string): string {
	return createHash("sha256").update(canonicalRoot).digest("hex").slice(0, 24);
}

export function isPathInside(root: string, target: string): boolean {
	const rel = relative(resolve(root), resolve(target));
	return (
		rel === "" ||
		(rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep))
	);
}

export function validateConfig(
	value: unknown,
	canonicalRoot: string,
): VerificationConfig | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Partial<VerificationConfig>;
	if (
		candidate.version !== CONFIG_VERSION ||
		candidate.canonicalRoot !== canonicalRoot ||
		!Array.isArray(candidate.stages)
	)
		return undefined;
	if (
		!candidate.budgets ||
		typeof candidate.budgets !== "object" ||
		typeof candidate.retryLimit !== "number" ||
		!["inferred", "manual", "repo-override"].includes(candidate.provenance ?? "")
	)
		return undefined;
	const validStages = candidate.stages.every(
		(stage) =>
			stage &&
			["format", "lint", "check", "test"].includes(stage.stage) &&
			typeof stage.command === "string" &&
			stage.command.length > 0 &&
			!/[\0\r\n]/.test(stage.command) &&
			Array.isArray(stage.args) &&
			stage.args.every(
				(arg) => typeof arg === "string" && !/[\0\r\n]/.test(arg),
			) &&
			["changed-files", "project", "nearby-tests", "changed-packages"].includes(
				stage.applicability,
			) &&
			Number.isFinite(stage.timeoutMs) &&
			stage.timeoutMs > 0,
	);
	if (!validStages) return undefined;
	const budgets = candidate.budgets as Partial<VerificationBudgets>;
	const budgetKeys: (keyof VerificationBudgets)[] = [
		"maxChangedFiles",
		"maxFocusedTests",
		"commandTimeoutMs",
		"totalTimeoutMs",
		"finalTotalTimeoutMs",
		"maxOutputBytes",
	];
	if (
		budgetKeys.some(
			(key) =>
				!Object.hasOwn(budgets, key) ||
				!Number.isFinite(budgets[key]!) ||
				(budgets[key] as number) <= 0,
		)
	)
		return undefined;
	if (
		!Number.isInteger(candidate.retryLimit) ||
		candidate.retryLimit < 0 ||
		candidate.retryLimit > 3
	)
		return undefined;
	return candidate as VerificationConfig;
}
