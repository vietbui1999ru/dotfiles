/**
 * Where a dispatched Pi pane goes: beside Claude in a named template, or in the `pi` tab.
 *
 * `placePane` is pure, so the templates are testable without herdr. The CLI at the
 * bottom reads the tab's layout from herdr and prints the same decision as JSON;
 * scripts/pi-view turns it into a `herdr pane split` and falls back to the `pi` tab
 * on anything it does not understand.
 *
 * herdr's `--ratio` sizes the pane being split, not the new one (checked against
 * herdr 0.9.5), so a ratio of 0.6 leaves the anchor with 60% and gives the new
 * pane 40%.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

/** An agent pane never gets smaller than this, and Claude never gives up more than the rest. */
export const MIN_AGENT_WIDTH = 40;
export const MIN_AGENT_HEIGHT = 8;
export const MIN_ANCHOR_WIDTH = 60;
export const MIN_ANCHOR_HEIGHT = 12;
/** A tab at least this wide fits a side column; narrower ones put the agents below. */
export const AUTO_SIDE_WIDTH = 160;
export const MAX_AGENTS = 3;
/** The anchor keeps this share when the first agent splits it. */
const ANCHOR_SHARE = 0.6;
/** Two panes that share a split get equal halves. */
const EVEN_SHARE = 0.5;

const TAB = { kind: "tab" };

/** `auto` picks a template from the tab width; every other layout names itself. */
export const resolveLayout = (layout, area) => {
	if (layout !== "auto") return layout;
	return area.width >= AUTO_SIDE_WIDTH ? "side" : "below";
};

/**
 * One placement decision for the next agent pane.
 * @param {{ layout: string, area: { width: number, height: number }, anchor: { pane_id?: string, width: number, height: number }, agents: readonly ({ pane_id?: string, width: number, height: number })[], max?: number }} input
 * @returns {{ kind: "split", target: string, direction: "right" | "down", ratio: number } | { kind: "tab" }}
 */
export const placePane = ({ layout, area, anchor, agents, max = MAX_AGENTS }) => {
	const resolved = resolveLayout(layout, area);
	if (resolved !== "side" && resolved !== "below") return { ...TAB };
	if (agents.length >= max) return { ...TAB };
	const side = resolved === "side";
	if (agents.length === 0) {
		const extent = side ? anchor.width : anchor.height;
		const grown = Math.floor(extent * (1 - ANCHOR_SHARE));
		const kept = Math.floor(extent * ANCHOR_SHARE);
		const agentMin = side ? MIN_AGENT_WIDTH : MIN_AGENT_HEIGHT;
		const anchorMin = side ? MIN_ANCHOR_WIDTH : MIN_ANCHOR_HEIGHT;
		if (grown < agentMin || kept < anchorMin) return { ...TAB };
		return { kind: "split", target: anchor.pane_id, direction: side ? "right" : "down", ratio: ANCHOR_SHARE };
	}
	// Later agents carve up the last agent's column or row, so every pane stays usable.
	const last = agents[agents.length - 1];
	const grown = Math.floor((side ? last.height : last.width) * (1 - EVEN_SHARE));
	if (grown < (side ? MIN_AGENT_HEIGHT : MIN_AGENT_WIDTH)) return { ...TAB };
	return { kind: "split", target: last.pane_id, direction: side ? "down" : "right", ratio: EVEN_SHARE };
};

/**
 * The inputs `placePane` needs, from a `pane layout` result. Agent ids that are not
 * in the anchor's tab any more are dropped, in the order they were opened.
 */
export const inputsFromLayout = (layout, anchorId, agentIds) => {
	const panes = new Map((layout.panes ?? []).map(pane => [pane.pane_id, pane]));
	const anchor = panes.get(anchorId);
	if (!anchor) return undefined;
	return {
		area: layout.area,
		anchor: { pane_id: anchorId, ...anchor.rect },
		agents: agentIds.flatMap(id => {
			const pane = panes.get(id);
			return pane ? [{ pane_id: id, ...pane.rect }] : [];
		}),
	};
};

const herdrBin = () => process.env.HERDR_BIN_PATH || "herdr";

/** The anchor's tab layout, or undefined when herdr fails or answers something unexpected. */
const readLayout = paneId => {
	try {
		const output = execFileSync(herdrBin(), ["pane", "layout", "--pane", paneId], {
			encoding: "utf8",
			maxBuffer: 8 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
		return JSON.parse(output).result.layout;
	} catch {
		return undefined;
	}
};

/** `pi-layout <layout> <anchor pane id> <agent pane ids…>` prints the decision, or fails silently. */
const main = argv => {
	const [template, anchorId, ...agentIds] = argv;
	if (!template || !anchorId) {
		process.stderr.write("usage: pi-layout auto|side|below|tab <anchor pane id> <agent pane ids…>\n");
		return 2;
	}
	const layout = readLayout(anchorId);
	const inputs = layout && inputsFromLayout(layout, anchorId, agentIds);
	if (!inputs) return 1;
	process.stdout.write(`${JSON.stringify(placePane({ layout: template, ...inputs }))}\n`);
	return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = main(process.argv.slice(2));
	} catch {
		// Any herdr failure is the caller's cue to use the `pi` tab.
		process.exitCode = 1;
	}
}
