/**
 * Pure state rendering for scripts/herdr-sketchybar-bridge, split out so it
 * can be tested without a Herdr socket. Glyphs and colors live on the
 * sketchybar items (items/agents.sh, colors.sh); this only decides what they show.
 */

// Most urgent first: the total takes the color of the first status present
// among non-blocked panes, so it reads like herdr's own status dot.
const TOTAL_ORDER = ["working", "done", "idle", "unknown"];
const KNOWN = new Set(["blocked", ...TOTAL_ORDER]);

/**
 * @param {Iterable<string>} statuses  one herdr agent_status per Claude pane
 * @param {number} piRunning           running pueue (Pi) tasks
 * @param {string | undefined} next    latest "NEXT: ..." line, if any
 * @returns {{ blocked: number, total: number, totalStatus: string, pi: number, next: string }}
 *   totalStatus is "" when no non-blocked pane exists.
 */
export function renderState(statuses, piRunning = 0, next = undefined) {
	const seen = new Set();
	let blocked = 0;
	let total = 0;
	for (const raw of statuses) {
		const status = KNOWN.has(raw) ? raw : "unknown";
		total++;
		if (status === "blocked") blocked++;
		else seen.add(status);
	}
	return {
		blocked,
		total,
		totalStatus: TOTAL_ORDER.find((status) => seen.has(status)) ?? "",
		pi: piRunning,
		next: next ? shortNext(next) : "",
	};
}

/**
 * Bar-sized gist of a NEXT line: no TUI junk, no (parentheticals), at most
 * five words, trailing [tag] kept.
 */
export function shortNext(line) {
	const text = cleanNext(line).replace(/\s*\([^)]*\)/g, "");
	const tag = /\s*(\[[^\]]+\])$/.exec(text);
	const body = (tag ? text.slice(0, tag.index) : text).split(/\s+/).filter(Boolean);
	const words = body.slice(0, 5).join(" ").replace(/[,;:]$/, "");
	const gist = body.length > 5 ? `${words}…` : words;
	return [gist, tag?.[1]].filter(Boolean).join(" ");
}

// A matched terminal line can carry whatever the TUI drew beside it (box
// borders, side panels), so keep only the text before the first "│" or run
// of 3+ spaces.
function cleanNext(line) {
	return line.replace(/^\s*NEXT:\s*/, "").split(/│|\s{3,}/)[0].trim();
}
