// Pure logic for the gate guard extension, with no Pi import, so `bun test` can
// load it outside a Pi session.
//
// The approval gates (scripts/spec approve, scripts/agent-review approve) are the
// person's decision. An agent can skip them three ways: run approve itself, write
// the approval record the gate would have written, or edit the gate or its guards.
// This refuses all three, best effort: a path assembled at run time is not caught,
// and a bash command that rewrites a guard file in place (sed -i) is not judged.

import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export interface CallLike {
	toolName: string;
	input: Record<string, unknown>;
}

const EDIT_TOOLS = new Set(["write", "edit"]);

// Records the gates write: spec approvals and agent-review decisions.
const STATE = [/\/\.local\/state\/ac-run(?:\/|$)/, /\/\.pi\/agent-review\/decisions(?:\/|$)/];

// Files that hold the gates and the guards, in any checkout of dotfiles.
const GUARDS = [
	/\/\.claude\/settings(?:\.local)?\.json$/,
	/\/\.claude\/hooks\//,
	/\/dotfiles\/(?:.+\/)?scripts\/(?:agent-review|spec)$/,
	/\/dotfiles\/(?:.+\/)?pi\/\.pi\/agent\/extensions\/(?:.+\/)?(?:secrets|gate)-guard[^/]*$/,
	/\/dotfiles\/(?:.+\/)?codex-guardrails-plugin\/hooks\//,
];

// Bash text: the state directories by any home spelling, or an approve call.
const BASH = [/\.local\/state\/ac-run\b/, /\.pi\/agent-review\/decisions\b/, /\b(?:agent-review|spec)\s+approve\b/];

function candidates(raw: string, home: string, cwd: string): string[] {
	const expanded = raw === "~" || raw.startsWith("~/") ? join(home, raw.slice(1)) : raw;
	const out = [resolve(cwd, expanded)];
	try {
		out.push(realpathSync(out[0]));
	} catch {
		// Not there yet: the resolved form is all there is to judge.
	}
	return out;
}

/** True when a write or edit targets gate state or a guard file. */
export function protectedTarget(raw: string, home: string = homedir(), cwd: string = process.cwd()): boolean {
	return candidates(raw, home, cwd).some((p) => [...STATE, ...GUARDS].some((re) => re.test(p)));
}

/** True when bash text names gate state or runs an approve, quotes and backslashes dropped. */
export function bashReachesGate(command: string): boolean {
	const bare = command.replace(/[\\'"]/g, "");
	return BASH.some((re) => re.test(bare));
}

/** True when the call must be refused. */
export function gateBlocked(call: CallLike, home: string = homedir(), cwd: string = process.cwd()): boolean {
	const { path, command } = call.input;
	if (EDIT_TOOLS.has(call.toolName) && typeof path === "string" && protectedTarget(path, home, cwd)) return true;
	return call.toolName === "bash" && typeof command === "string" && bashReachesGate(command);
}
