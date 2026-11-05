// Gate guard for Pi: approving a spec or a Pi run is the person's decision.
// Refuses a bash call that runs `spec approve` or `agent-review approve` or names
// the approval records, and a write or edit that targets those records or the
// files holding the gates and guards. Logic and limits: lib/gate-guard-core.ts.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { gateBlocked } from "./lib/gate-guard-core.ts";

const BLOCK_REASON =
	"Blocked by the gate guard: approvals, approval records and the guard files are the person's to change. " +
	"Report what needs approving or editing and stop.";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (!gateBlocked({ toolName: event.toolName, input: event.input })) return;
		return { block: true, reason: BLOCK_REASON };
	});
}
