// Secrets guard for Pi: the rule in shared/AGENTS.md, enforced instead of only
// stated. Claude Code has claude/.claude/hooks/enforce-bash-safety.sh and the
// pre-commit secret-scan; Pi had nothing, so an agent could read ~/secrets/.env
// and copy every key out.
//
// 1. Refuse a tool call that reaches ~/secrets: the directory or a file in it,
//    whether the call is bash, a path tool, an MCP tool or a codemode script.
// 2. Send a text tool result that mentions a key back through scripts/redact, so
//    a key that arrives another way (a log, a config, shell history) leaves as
//    [REDACTED:NAME].
//
// Best effort by design, see lib/secrets-guard-core.ts: a path assembled at run
// time is not caught. The loaders are secret-get and with-secrets.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	blockedCall,
	redactText,
	shouldRedact,
} from "./lib/secrets-guard-core.ts";

const BLOCK_REASON =
	"Blocked by the secrets guard: this call reaches ~/secrets. " +
	"Read one key with ~/dotfiles/scripts/secret-get NAME, run a command with only the keys it needs " +
	"through ~/dotfiles/scripts/with-secrets, and pass text that may hold a key through " +
	"~/dotfiles/scripts/redact.";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!blockedCall({ toolName: event.toolName, input: event.input })) return;
		return { block: true, reason: BLOCK_REASON };
	});

	pi.on("tool_result", async (event) => {
		let changed = false;
		const content = event.content.map((block) => {
			if (block.type !== "text" || !shouldRedact(block.text)) return block;
			const redacted = redactText(block.text);
			if (redacted === undefined || redacted === block.text) return block;
			changed = true;
			return { ...block, text: redacted };
		});
		if (!changed) return;
		// structuredContent may repeat the raw value, and a replaced content block
		// drops it anyway. Dropping it is the point.
		return { content };
	});
}
