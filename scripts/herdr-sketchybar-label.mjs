/**
 * Pure label rendering for scripts/herdr-sketchybar-bridge, split out so it
 * can be tested without a Herdr socket. Glyphs are Nerd Font codepoints
 * (Hack Nerd Font Mono, the font sketchybar renders the agents item in).
 */

export const CLAUDE_ICON = "\u{F16A1}"; // md-robot (also the C workspace icon)
export const PI_ICON = "\u{F08EA}"; // md-hammer
export const NEXT_ICON = "\u{F101}"; // fa-angles-right

// Display order and glyph per status bucket. "done" counts as idle.
const BUCKETS = [
	["working", "●"],
	["blocked", "!"],
	["idle", "○"],
	["unknown", "?"],
];
const KNOWN = new Set(BUCKETS.map(([status]) => status));

function bucketOf(status) {
	if (status === "done") return "idle";
	return KNOWN.has(status) ? status : "unknown";
}

/**
 * @param {Iterable<string>} statuses  one herdr agent_status per Claude pane
 * @param {number} piRunning           running pueue (Pi) tasks
 * @param {string | undefined} next    latest "NEXT: ..." line, if any
 * @returns e.g. "󱚡 2● 1! 3○ │ 󰣪 1● │  build the thing"
 */
export function renderLabel(statuses, piRunning = 0, next = undefined) {
	const counts = new Map();
	for (const status of statuses) {
		const bucket = bucketOf(status);
		counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
	}
	const claude = BUCKETS
		.filter(([bucket]) => counts.has(bucket))
		.map(([bucket, glyph]) => `${counts.get(bucket)}${glyph}`)
		.join(" ");
	const parts = [`${CLAUDE_ICON} ${claude || "–"}`];
	if (piRunning > 0) parts.push(`${PI_ICON} ${piRunning}●`);
	const job = next && cleanNext(next);
	if (job) parts.push(`${NEXT_ICON} ${job}`);
	return parts.join(" │ ");
}

// A matched terminal line can carry whatever the TUI drew beside it (box
// borders, side panels), so keep only the text before the first "│" or run
// of 3+ spaces.
function cleanNext(line) {
	return line.replace(/^\s*NEXT:\s*/, "").split(/│|\s{3,}/)[0].trim();
}
