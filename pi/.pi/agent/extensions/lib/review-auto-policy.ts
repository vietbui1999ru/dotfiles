export interface AutoReviewFile {
	path: string;
	changedLoc: number;
	action: "create" | "modify" | "delete" | "rename";
}

export interface AutoReviewPolicy {
	maxChangedLocPerFile: number;
	maxChangedLocPerBatch: number;
	maxFiles: number;
}

export interface AutoReviewDecision {
	eligible: boolean;
	reasons: string[];
}

export const DEFAULT_AUTO_REVIEW_POLICY: AutoReviewPolicy = {
	maxChangedLocPerFile: 100,
	maxChangedLocPerBatch: 300,
	maxFiles: 12,
};

const PROTECTED_PATHS = [
	/(^|\/)(?:\.github\/workflows|\.gitlab-ci|\.circleci|deploy|infra|terraform|k8s|helm)(\/|$)/i,
	/(^|\/)(?:migrations?|database|db)(\/|$)/i,
	/(^|\/)(?:auth|security|secrets?)(\/|$)/i,
	/(^|\/)(?:\.env(?:\.|$)|credentials?)(\/|$)/i,
];

const PROTECTED_FILES = new Set([
	"package-lock.json",
	"pnpm-lock.yaml",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"Cargo.lock",
	"go.sum",
	"Gemfile.lock",
	"poetry.lock",
]);

function normalized(path: string): string {
	return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function riskReason(path: string): string | undefined {
	const normalizedPath = normalized(path);
	if (PROTECTED_FILES.has(normalizedPath.split("/").at(-1) ?? ""))
		return "dependency lockfile";
	if (PROTECTED_PATHS.some((pattern) => pattern.test(normalizedPath)))
		return "protected path";
	return undefined;
}

/**
 * Decides whether a batch may run sandbox checks before automatic application.
 * A caller must still require passing, non-mutating verification before apply.
 */
export function evaluateAutoReview(
	files: AutoReviewFile[],
	policy: AutoReviewPolicy = DEFAULT_AUTO_REVIEW_POLICY,
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

	for (const file of files) {
		if (file.changedLoc > policy.maxChangedLocPerFile)
			reasons.push(
				`${file.path} changes ${file.changedLoc} LOC (limit ${policy.maxChangedLocPerFile})`,
			);
		const risk = riskReason(file.path);
		if (risk) reasons.push(`${file.path} is a ${risk}`);
	}

	return { eligible: reasons.length === 0, reasons };
}
