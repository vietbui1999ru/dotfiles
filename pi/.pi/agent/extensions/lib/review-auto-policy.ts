import {
	CODE_EXTENSIONS,
	MANIFEST_AND_CONFIG_NAMES,
} from "./post-run-verifier-core.ts";

export interface AutoReviewFile {
	path: string;
	oldPath?: string;
	changedLoc: number;
	action: "create" | "modify" | "delete" | "rename";
	/** Binary files are never auto-applied: LOC counting cannot judge them. */
	binary?: boolean;
}

export interface AutoReviewPolicy {
	maxChangedLocPerFile: number;
	maxChangedLocPerBatch: number;
	maxFiles: number;
	maxSessionAutoAppliedLoc: number;
}

export interface AutoReviewDecision {
	eligible: boolean;
	reasons: string[];
}

export const DEFAULT_AUTO_REVIEW_POLICY: AutoReviewPolicy = {
	maxChangedLocPerFile: 100,
	maxChangedLocPerBatch: 300,
	maxFiles: 12,
	maxSessionAutoAppliedLoc: 600,
};

/**
 * Auto-apply must be opted into explicitly per session; it is off by default.
 * Any value other than exactly "1" (including unset) disables it.
 */
export function autoApplyEnabledFromEnv(env: NodeJS.ProcessEnv): boolean {
	return env.PI_REVIEW_GATE_AUTO_APPLY === "1";
}

function normalized(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function basename(path: string): string {
	return path.split("/").at(-1) ?? path;
}

function stem(name: string): string {
	return name.replace(/\.[^.]*$/, "");
}

/** Auth/security/secret/credential names, as directory segments or file stems. */
const PROTECTED_NAME =
	/^(auth|authentication|authorization|security|secrets?|credentials?)([-._].*)?$/i;

/** Directory segments that always require manual review. */
const PROTECTED_SEGMENTS = new Set([
	"db",
	"database",
	"migrations",
	"migration",
	"terraform",
	"k8s",
	"helm",
	"infra",
	"infrastructure",
	"deploy",
	"deploys",
	"deployment",
	"deployments",
	"bin",
	"vault",
	"pki",
]);

const CI_DIRS = new Set([".github", ".gitlab", ".circleci", ".drone"]);

const CI_BASENAME_PATTERNS = [
	/^\.gitlab-ci/i,
	/^Jenkinsfile/i,
	/^azure-pipelines/i,
	/^bitbucket-pipelines/i,
	/^\.travis\.ya?ml$/i,
	/^\.drone\.ya?ml$/i,
	/^buildkite\.ya?ml$/i,
	/^action\.ya?ml$/i,
	/^\.pre-commit-config\./i,
];

const CONTAINER_PATTERNS = [
	/^Dockerfile/i,
	/^Containerfile/i,
	/^docker-compose/i,
	/^compose\.(ya?ml)$/i,
	/^\.dockerignore$/i,
];

const BUILD_PATTERNS = [
	/^Makefile/i,
	/\.mk$/i,
	/^CMakeLists\.txt$/i,
	/^configure(\.ac)?$/i,
	/^Makefile\.am$/i,
	/^justfile$/i,
	/^Taskfile/i,
	/^build\.gradle/i,
	/^settings\.gradle/i,
	/^gradlew(\.bat)?$/i,
	/^pom\.xml$/i,
	/^meson\.build$/i,
	/^SConstruct$/i,
	/^Rakefile$/i,
];

const IAC_PATTERNS = [/\.tf$/i, /\.tfvars$/i, /\.hcl$/i, /^Pulumi\..*\.ya?ml$/i];

const HOOK_DIRS = new Set([".husky", ".githooks"]);

const HOOK_BASENAMES = new Set([
	"pre-commit",
	"commit-msg",
	"pre-push",
	"pre-receive",
	"post-commit",
	"post-merge",
	"post-receive",
	"prepare-commit-msg",
	"pre-rebase",
	"pre-merge-commit",
	"applypatch-msg",
]);

/** Package-manager config files outside the verifier's manifest set. */
const EXTRA_CONFIG_NAMES = new Set([".npmrc", ".yarnrc", ".yarnrc.yml"]);

/**
 * Deny-by-default risk classification for one path. Anything that is not a
 * known source extension outside every protected location requires review.
 */
function pathRisk(rawPath: string): string | undefined {
	const path = normalized(rawPath);
	const name = basename(path);
	const nameStem = stem(name);
	const segments = path.split("/").slice(0, -1);
	const extension = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";

	if (name.toLowerCase().startsWith(".env")) return "secrets file";
	if (/secret|credential/i.test(name)) return "secrets file";
	if (MANIFEST_AND_CONFIG_NAMES.has(name)) return "verification config";
	if (EXTRA_CONFIG_NAMES.has(name)) return "package config";
	if (segments.some((segment) => CI_DIRS.has(segment.toLowerCase())))
		return "CI configuration";
	if (CI_BASENAME_PATTERNS.some((pattern) => pattern.test(name)))
		return "CI configuration";
	if (CONTAINER_PATTERNS.some((pattern) => pattern.test(name)))
		return "container build file";
	if (BUILD_PATTERNS.some((pattern) => pattern.test(name))) return "build file";
	if (IAC_PATTERNS.some((pattern) => pattern.test(name)))
		return "infrastructure file";
	if (
		segments.some((segment) => HOOK_DIRS.has(segment.toLowerCase())) ||
		HOOK_BASENAMES.has(nameStem.toLowerCase())
	)
		return "git hook";
	if (
		segments.some(
			(segment) =>
				PROTECTED_SEGMENTS.has(segment.toLowerCase()) ||
				PROTECTED_NAME.test(segment),
		) ||
		PROTECTED_NAME.test(nameStem)
	)
		return "protected path";
	if (!CODE_EXTENSIONS.has(extension.toLowerCase()))
		return "non-source file";
	return undefined;
}

/**
 * Decides whether a batch may run sandbox checks before automatic application.
 * A caller must still require passing, non-mutating verification before apply.
 * Renames and deletes are checked against both their old and new paths.
 */
export function evaluateAutoReview(
	files: AutoReviewFile[],
	policy: AutoReviewPolicy = DEFAULT_AUTO_REVIEW_POLICY,
	sessionAutoAppliedLoc = 0,
): AutoReviewDecision {
	const reasons: string[] = [];
	if (files.length === 0) reasons.push("batch has no files");
	if (files.length > policy.maxFiles)
		reasons.push(`batch has ${files.length} files (limit ${policy.maxFiles})`);

	const totalChangedLoc = files.reduce((total, file) => total + file.changedLoc, 0);
	if (totalChangedLoc > policy.maxChangedLocPerBatch)
		reasons.push(
			`batch changes ${totalChangedLoc} LOC (limit ${policy.maxChangedLocPerBatch})`,
		);
	if (sessionAutoAppliedLoc + totalChangedLoc > policy.maxSessionAutoAppliedLoc)
		reasons.push(
			`session auto-apply cap: ${sessionAutoAppliedLoc} LOC already auto-applied plus ${totalChangedLoc} pending exceeds ${policy.maxSessionAutoAppliedLoc} LOC`,
		);

	for (const file of files) {
		if (file.changedLoc > policy.maxChangedLocPerFile)
			reasons.push(
				`${file.path} changes ${file.changedLoc} LOC (limit ${policy.maxChangedLocPerFile})`,
			);
		if (file.binary)
			reasons.push(`${file.path} is a binary file; manual review required`);
		for (const candidate of [file.path, file.oldPath]) {
			if (!candidate) continue;
			const risk = pathRisk(candidate);
			if (risk) reasons.push(`${candidate} is a ${risk}`);
		}
	}

	return { eligible: reasons.length === 0, reasons };
}
