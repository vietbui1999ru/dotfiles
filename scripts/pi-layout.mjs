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
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

/** An agent pane never gets smaller than this, and Claude never gives up more than the rest. */
export const MIN_AGENT_WIDTH = 40;
export const MIN_AGENT_HEIGHT = 8;
export const MIN_ANCHOR_WIDTH = 60;
export const MIN_ANCHOR_HEIGHT = 12;
/** A tab at least this wide fits a side column; narrower ones put the agents below. */
export const AUTO_SIDE_WIDTH = 160;
export const MAX_AGENTS = 2;
/** A grid tab holds at most this many tiles; the next one opens `pi-2`, `verdict-2`, and so on. */
export const GRID_MAX = 6;
/** Grid columns never exceed this, however wide the tab. */
const GRID_MAX_COLUMNS = 3;
/** The anchor keeps this share when the first agent splits it. */
const ANCHOR_SHARE = 0.6;
/** Two panes that share a split get equal halves. */
const EVEN_SHARE = 0.5;

/** A split within this much of its even share is left alone, so a rebalance is quiet when nothing moved. */
const RATIO_EPSILON = 0.01;

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

/** Columns a grid tab of this width holds: as many as fit at MIN_AGENT_WIDTH, from 1 to 3. */
export const gridColumns = width => Math.max(1, Math.min(GRID_MAX_COLUMNS, Math.floor(width / MIN_AGENT_WIDTH)));

/** The leaves of a subtree, left to right, top to bottom. */
const leavesOf = node => (node.type === "pane" ? [node] : [...leavesOf(node.first), ...leavesOf(node.second)]);

/**
 * The columns of a grid tab: the leaves of its root `right` chain, each as a list of
 * tiles. A root that is not a `right` chain is one column.
 */
const columnsOf = root => {
	const columns = [];
	let node = root;
	while (node.type === "split" && node.direction === "right") {
		columns.unshift(node.second);
		node = node.first;
	}
	columns.unshift(node);
	return columns.map(leavesOf);
};

/**
 * Where the next tile of a grid tab goes, filled row-major: a new column while there are
 * fewer than `gridColumns(width)` and the rightmost column is a single tile, otherwise the
 * bottom tile of the shortest column (leftmost on a tie). Full at GRID_MAX tiles, or when
 * the next tile would fall under MIN_AGENT_HEIGHT rows.
 * @param {object} root a `layout.export` root node
 * @param {{ width: number, height: number }} area
 * @returns {{ kind: "split", target: string, direction: "right" | "down" } | { kind: "full" }}
 */
export const planGridAdd = (root, area) => {
	const columns = columnsOf(root);
	const tiles = columns.reduce((sum, column) => sum + column.length, 0);
	if (tiles >= GRID_MAX) return { kind: "full" };
	const shortest = columns.reduce((best, column, index) => (column.length < columns[best].length ? index : best), 0);
	const rows = columns[shortest].length + 1;
	const rowHeight = Math.floor(area.height / rows);
	if (columns.length < gridColumns(area.width) && columns[columns.length - 1].length === 1) {
		// A new column next to the rightmost tile: each tile gets the full height.
		if (Math.floor(area.width / (columns.length + 1)) < MIN_AGENT_WIDTH) return { kind: "full" };
		return { kind: "split", target: columns[columns.length - 1][0].pane_id, direction: "right" };
	}
	if (rowHeight < MIN_AGENT_HEIGHT) return { kind: "full" };
	const bottom = columns[shortest][columns[shortest].length - 1];
	return { kind: "split", target: bottom.pane_id, direction: "down" };
};

/** `pi`, `pi-2`, … for n ≥ 2, and the bare series name for the first tab. */
export const seriesLabel = (series, n) => (n <= 1 ? series : `${series}-${n}`);

/**
 * The grid tab a new tile goes into: the first tab of the series with room, or the next
 * missing label. `tabs` holds the series tabs already in the workspace, each with its
 * layout root and area.
 * @param {"pi" | "verdict"} series
 * @param {{ tab_id: string, label: string, root: object, area: { width: number, height: number } }[]} tabs
 * @returns {{ kind: "split", tab_id: string, target: string, direction: "right" | "down" } | { kind: "new-tab", label: string }}
 */
export const pickGridTab = (series, tabs) => {
	for (let n = 1; n <= tabs.length + 1; n++) {
		const label = seriesLabel(series, n);
		const tab = tabs.find(candidate => candidate.label === label);
		if (!tab) return { kind: "new-tab", label };
		const plan = planGridAdd(tab.root, tab.area);
		if (plan.kind === "split") return { kind: "split", tab_id: tab.tab_id, target: plan.target, direction: plan.direction };
	}
	return { kind: "new-tab", label: seriesLabel(series, tabs.length + 1) };
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

/**
 * Weight of a subtree along a split direction: a split in that direction adds its
 * children; anything else is one tile. Tiles in a perpendicular subtree count once.
 */
const weightAlong = (node, direction) => {
	if (node.type !== "split" || node.direction !== direction) return 1;
	return weightAlong(node.first, direction) + weightAlong(node.second, direction);
};

/** Whether the subtree holds a pane in `keep`. */
const holdsKept = (node, keep) =>
	node.type === "pane" ? keep.has(node.pane_id) : holdsKept(node.first, keep) || holdsKept(node.second, keep);

/**
 * The `layout.set_split_ratio` calls that make every tile of a split tree even.
 * Each split's ratio is its first child's share of the tiles along its own direction.
 * A split holding a kept pane is left as it is, but its children are still visited.
 * @param {object} root a `layout.export` root node
 * @param {ReadonlySet<string>} [keep] pane ids whose splits must not change
 * @returns {{ path: boolean[], ratio: number }[]}
 */
export const rebalancePlan = (root, keep = new Set()) => {
	const plan = [];
	const visit = (node, path) => {
		if (node.type !== "split") return;
		if (!holdsKept(node, keep)) {
			const before = weightAlong(node.first, node.direction);
			const after = weightAlong(node.second, node.direction);
			const target = before / (before + after);
			if (Math.abs(node.ratio - target) > RATIO_EPSILON) plan.push({ path, ratio: target });
		}
		visit(node.first, [...path, false]);
		visit(node.second, [...path, true]);
	};
	visit(root, []);
	return plan;
};

const SOCKET_TIMEOUT_MS = 3000;

/**
 * One herdr socket request: a JSON line out, the first line back. Resolves the
 * `result`, or undefined on an `error`, a missing or refusing socket, or a timeout.
 */
export const herdrRequest = (method, params) =>
	new Promise(resolve => {
		const path = process.env.HERDR_SOCKET_PATH;
		if (!path) return resolve(undefined);
		let buffer = "";
		let settled = false;
		const finish = value => {
			if (settled) return;
			settled = true;
			socket.destroy();
			resolve(value);
		};
		const socket = connect(path);
		socket.setTimeout(SOCKET_TIMEOUT_MS, () => finish(undefined));
		socket.on("error", () => finish(undefined));
		socket.on("connect", () => socket.write(`${JSON.stringify({ id: "1", method, params })}\n`));
		socket.on("data", chunk => {
			buffer += chunk.toString("utf8");
			const newline = buffer.indexOf("\n");
			if (newline === -1) return;
			try {
				const reply = JSON.parse(buffer.slice(0, newline));
				finish(reply.error ? undefined : reply.result);
			} catch {
				finish(undefined);
			}
		});
	});

/** Tabs `rebalance` may touch: the pi and verdict series only. */
const GRID_LABEL = /^(pi|verdict)(-\d+)?$/;

/** Evens one tab's split tree over the socket. Returns false when herdr cannot answer. */
const rebalanceTab = async (tabId, keep) => {
	const exported = await herdrRequest("layout.export", { tab_id: tabId });
	if (!exported?.layout?.root) return false;
	for (const { path, ratio } of rebalancePlan(exported.layout.root, keep)) {
		await herdrRequest("layout.set_split_ratio", { tab_id: tabId, path, ratio });
	}
	return true;
};

/** `pi-layout rebalance <tab id> | --focused [--keep <pane id>…]`: evens a grid tab. */
const rebalanceMain = async argv => {
	const keepAt = argv.indexOf("--keep");
	const keepIds = keepAt === -1 ? [] : argv.slice(keepAt + 1);
	const args = keepAt === -1 ? argv : argv.slice(0, keepAt);
	const keep = new Set(keepIds);
	if (!args[0]) return 2;
	const tabs = (await herdrRequest("tab.list", {}))?.tabs;
	if (!tabs) return 1;
	const tab = args[0] === "--focused" ? tabs.find(candidate => candidate.focused) : tabs.find(candidate => candidate.tab_id === args[0]);
	if (!tab) return 1;
	// Only the pi and verdict series are grid tabs; anything else is left alone.
	if (!GRID_LABEL.test(tab.label ?? "")) return 0;
	return (await rebalanceTab(tab.tab_id, keep)) ? 0 : 1;
};

/**
 * A tab's area in columns and rows. herdr's socket `layout.export` carries only the split
 * tree, so the area comes from `pane layout`, read through any pane of the tab.
 */
const areaOfTab = (tabId, workspaceId) => {
	try {
		const listing = execFileSync(herdrBin(), ["pane", "list", "--workspace", workspaceId], {
			encoding: "utf8",
			maxBuffer: 8 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		});
		const paneId = JSON.parse(listing).result.panes?.find(pane => pane.tab_id === tabId)?.pane_id;
		if (!paneId) return undefined;
		const layout = JSON.parse(execFileSync(herdrBin(), ["pane", "layout", "--pane", paneId], {
			encoding: "utf8",
			maxBuffer: 8 * 1024 * 1024,
			stdio: ["ignore", "pipe", "ignore"],
		})).result.layout;
		return layout.area;
	} catch {
		return undefined;
	}
};

/**
 * `pi-layout grid <pi|verdict> <workspace id>`: prints where the next grid tile goes, as
 * the pickGridTab decision. Fails (exit 1) when herdr cannot list the workspace's tabs or
 * read one of their layouts, so the caller keeps today's `pi`-tab fallback.
 */
const gridMain = async argv => {
	const [series, workspace] = argv;
	if ((series !== "pi" && series !== "verdict") || !workspace) return 2;
	const listed = (await herdrRequest("tab.list", { workspace_id: workspace }))?.tabs;
	if (!listed) return 1;
	const seriesTabs = listed.filter(tab => tab.workspace_id === workspace && GRID_LABEL.test(tab.label ?? "") && tab.label.startsWith(series));
	const tabs = [];
	for (const tab of seriesTabs) {
		const exported = await herdrRequest("layout.export", { tab_id: tab.tab_id });
		if (!exported?.layout?.root) return 1;
		const area = areaOfTab(tab.tab_id, workspace);
		if (!area) return 1;
		tabs.push({ tab_id: tab.tab_id, label: tab.label, root: exported.layout.root, area });
	}
	process.stdout.write(`${JSON.stringify(pickGridTab(series, tabs))}\n`);
	return 0;
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
	const [command, ...rest] = process.argv.slice(2);
	const run =
		command === "rebalance" ? rebalanceMain(rest)
		: command === "grid" ? gridMain(rest)
		: Promise.resolve(main(process.argv.slice(2)));
	run
		.then(code => {
			process.exitCode = code;
		})
		.catch(() => {
			// Any herdr failure is the caller's cue to use the `pi` tab.
			process.exitCode = 1;
		});
}
