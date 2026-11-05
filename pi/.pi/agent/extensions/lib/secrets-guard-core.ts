// Pure logic for the secrets guard extension, with no Pi import, so `bun test`
// can load it outside a Pi session.
//
// It enforces the rule in shared/AGENTS.md: keys live in ~/secrets/.env, nothing
// reads that file directly, one key comes out through scripts/secret-get, and text
// that may hold a key goes through scripts/redact first.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";

export const REDACT_SCRIPT = join(homedir(), "dotfiles", "scripts", "redact");

const REDACT_TIMEOUT_MS = 10_000;
const REDACT_MAX_BYTES = 64 * 1024 * 1024;

// Fields that carry the text a write or edit will put in a file. Those are judged
// by the call's target path alone: this guard's own source quotes ~/secrets, and
// so does the documentation, so scanning content would refuse to write either.
const CONTENT_FIELDS = new Set(["content", "newText", "oldText", "new_string", "old_string"]);

// A path built at run time (S=~/s; cat "$S/.env") is not covered: no text the call
// carries names the directory. Best effort is the contract.
const SPELLINGS = (home: string) =>
	[join(home, "secrets"), "$HOME/secrets", "${HOME}/secrets", "~/secrets"];

// Only text that mentions a key-shaped name or token pays the redact subprocess.
// Ordinary code output stays untouched, and so does its `-library` and `PATH=`.
const REDACT_TRIGGER = new RegExp(
	[
		"\\b(?:sk-|sk_|oc_sk|ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|AIza|fc-|xox[abp]-|AKIA)",
		"\\bBearer[ \\t]",
		"[A-Za-z0-9_]*(?:key|token|secret|password|passwd|pass|pat|auth)[A-Za-z0-9_]*[ \\t]*[=:]",
		"[A-Za-z][A-Za-z0-9+.\\-]*://[^\\s:/@]+:[^\\s@/]+@",
	].join("|"),
	"i",
);

export interface CallLike {
	toolName: string;
	input: Record<string, unknown>;
}

/** The directory no tool may read, write or list. */
export function secretsDir(home: string = homedir()): string {
	return join(home, "secrets");
}

/**
 * True when the text names the secrets directory, however it is spelled and
 * quoted. Quotes and backslashes are dropped first, so `~/"sec"rets/.env` counts.
 */
export function namesSecretsPath(text: string, home: string = homedir()): boolean {
	const bare = text.replace(/[\\'"]/g, "");
	return SPELLINGS(home).some((spelling) => {
		for (let at = bare.indexOf(spelling); at >= 0; at = bare.indexOf(spelling, at + 1)) {
			const next = bare.charAt(at + spelling.length);
			// A longer name such as ~/secrets-backup is a different directory.
			if (!/[A-Za-z0-9_-]/.test(next)) return true;
		}
		return false;
	});
}

/**
 * True when a tool's target path resolves inside the secrets directory, which also
 * catches `../secrets/.env`, a relative path and a symlink into the directory.
 */
export function isInsideSecrets(
	raw: string,
	home: string = homedir(),
	cwd: string = process.cwd(),
): boolean {
	const expanded = raw === "~" || raw.startsWith("~/") ? join(home, raw.slice(1)) : raw;
	const resolved = resolve(cwd, expanded);
	const candidates = new Set([resolved]);
	try {
		candidates.add(realpathSync(resolved));
	} catch {
		// It does not exist yet: the resolved form is all there is to judge.
	}
	const dir = secretsDir(home);
	for (const candidate of candidates) {
		if (candidate === dir || candidate.startsWith(dir + sep)) return true;
	}
	return false;
}

/**
 * True when the text may hold a key, and so is worth a redact pass. A bare
 * key-shaped value sitting alone with no name beside it does not trigger.
 */
export function shouldRedact(text: string): boolean {
	return REDACT_TRIGGER.test(text);
}

/** Run text through the shared redactor. Undefined when it cannot be run. */
export function redactText(text: string, script: string = REDACT_SCRIPT): string | undefined {
	if (!text) return undefined;
	try {
		const run = spawnSync(script, [], {
			input: text,
			encoding: "utf-8",
			timeout: REDACT_TIMEOUT_MS,
			maxBuffer: REDACT_MAX_BYTES,
			stdio: ["pipe", "pipe", "ignore"],
		});
		if (run.error || run.status !== 0 || typeof run.stdout !== "string") return undefined;
		return run.stdout;
	} catch {
		return undefined;
	}
}

function searchableText(input: Record<string, unknown>): string {
	const parts: string[] = [];
	for (const [key, value] of Object.entries(input)) {
		if (CONTENT_FIELDS.has(key)) continue;
		if (typeof value === "string") parts.push(value);
		if (Array.isArray(value)) parts.push(...value.filter((item) => typeof item === "string"));
	}
	return parts.join("\n");
}

/** True when a tool call reaches the secrets directory and must be refused. */
export function blockedCall(call: CallLike, home: string = homedir(), cwd: string = process.cwd()): boolean {
	const target = call.input.path;
	if (typeof target === "string" && isInsideSecrets(target, home, cwd)) return true;
	return namesSecretsPath(searchableText(call.input), home);
}
