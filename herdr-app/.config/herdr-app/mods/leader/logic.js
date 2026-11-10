// Pure logic for the leader mod: the key map behind cmd-k, how a key press resolves to an
// entry, the resize step math, and the panel toggle decision. No imports from `herdr` or
// `gpui-*`, so Node can test it (scripts/leader-logic.test.mjs).
//
// An entry is { label, group, command, args? } for a one-shot command, or { label, group,
// mode: "resize" | "panel" ... } for a key that keeps the overlay open or needs the panel state.

export const GROUPS = ["Panes", "Tabs", "Spaces", "Panels", "Pi", "App"];

// The band's id and its heights: 24px normally, 48px while the hints show (two lines).
export const BAND_ID = "ai-spend";
export const BAND_PX = 24;
export const BAND_HINTS_PX = 48;

// The two hint lines the band shows, as groups. Every group appears once.
export const HINT_LINES = [["Panes", "Tabs", "Spaces"], ["Panels", "Pi", "App"]];

const dir = (key, label, command, args) => ({ key, label, group: "Panes", command, args });

// Keys are the printed key (`"h"`, `"H"`, `"1"`, `"Tab"`, `"]"`). A shifted letter is listed
// once in its capital form; resolveKey also accepts the lowercase letter with a shift modifier.
export const LEADER_MAP = {
  h: dir("h", "Focus left", "pane.go", { direction: "left" }),
  j: dir("j", "Focus down", "pane.go", { direction: "down" }),
  k: dir("k", "Focus up", "pane.go", { direction: "up" }),
  l: dir("l", "Focus right", "pane.go", { direction: "right" }),
  H: dir("H", "Swap left", "pane.swap", { direction: "left" }),
  J: dir("J", "Swap down", "pane.swap", { direction: "down" }),
  K: dir("K", "Swap up", "pane.swap", { direction: "up" }),
  L: dir("L", "Swap right", "pane.swap", { direction: "right" }),
  s: { key: "s", label: "Split right", group: "Panes", command: "pane.split", args: { direction: "right" } },
  v: { key: "v", label: "Split down", group: "Panes", command: "pane.split", args: { direction: "down" } },
  x: { key: "x", label: "Close pane", group: "Panes", command: "pane.close" },
  z: { key: "z", label: "Zoom pane", group: "Panes", command: "pane.zoom" },
  r: { key: "r", label: "Resize mode", group: "Panes", mode: "resize" },

  n: { key: "n", label: "Next tab", group: "Tabs", command: "tab.next" },
  p: { key: "p", label: "Previous tab", group: "Tabs", command: "tab.prev" },
  1: { key: "1", label: "Tab 1", group: "Tabs", command: "tab.select", args: { index: 1 } },
  2: { key: "2", label: "Tab 2", group: "Tabs", command: "tab.select", args: { index: 2 } },
  3: { key: "3", label: "Tab 3", group: "Tabs", command: "tab.select", args: { index: 3 } },
  4: { key: "4", label: "Tab 4", group: "Tabs", command: "tab.select", args: { index: 4 } },
  5: { key: "5", label: "Tab 5", group: "Tabs", command: "tab.select", args: { index: 5 } },
  6: { key: "6", label: "Tab 6", group: "Tabs", command: "tab.select", args: { index: 6 } },
  7: { key: "7", label: "Tab 7", group: "Tabs", command: "tab.select", args: { index: 7 } },
  8: { key: "8", label: "Tab 8", group: "Tabs", command: "tab.select", args: { index: 8 } },
  9: { key: "9", label: "Tab 9", group: "Tabs", command: "tab.select", args: { index: 9 } },

  "]": { key: "]", label: "Next space", group: "Spaces", command: "space.next" },
  "[": { key: "[", label: "Previous space", group: "Spaces", command: "space.prev" },
  w: { key: "w", label: "Workspaces", group: "Spaces", command: "workspaces.toggle" },

  e: { key: "e", label: "Files panel", group: "Panels", mode: "panel", child: "files" },
  c: { key: "c", label: "Changes panel", group: "Panels", mode: "panel", child: "changes" },
  Tab: { key: "Tab", label: "Other panel", group: "Panels", mode: "panel", child: "other" },
  b: { key: "b", label: "Toggle sidebar", group: "Panels", command: "layout.toggle", args: { id: "sidebar" } },

  a: { key: "a", label: "New agent", group: "Pi", command: "pi-fleet.new" },
  o: { key: "o", label: "Next agent", group: "Pi", command: "pi-fleet.next" },
  m: { key: "m", label: "Monitor", group: "Pi", command: "pi-fleet.monitor" },

  g: { key: "g", label: "Herdr-pi layout", group: "App", command: "layout.switch", args: { name: "herdr-pi" } },
  G: { key: "G", label: "Next layout", group: "App", command: "layout.switch" },
  R: { key: "R", label: "Restart Herdr", group: "App", command: "workspaces.restart" },
};

// The leader key's entry for a key event, or null for a key it does not own. Shifted letters
// arrive as "H" or as "h" with the shift modifier; both resolve to the capital entry.
export function resolveKey(event) {
  if (!event || typeof event.key !== "string") return null;
  let key = event.key;
  // GPUI spells named keys in lowercase ("tab"); the map uses the printed name ("Tab").
  if (key === "tab") key = "Tab";
  if (event.modifiers?.shift && isLower(key)) key = key.toUpperCase();
  return Object.prototype.hasOwnProperty.call(LEADER_MAP, key) ? LEADER_MAP[key] : null;
}

// Only a lowercase ASCII letter counts as a letter to shift; digits and punctuation do not.
function isLower(key) {
  return key.length === 1 && key >= "a" && key <= "z";
}

// The map as rows for drawing: the entries of one group, in map order.
export function rowsFor(group) {
  return Object.values(LEADER_MAP).filter((e) => e.group === group);
}

// Shows a key the way it is pressed: the plain key name, with Tab spelled out.
export function keyLabel(key) {
  return key === "Tab" ? "Tab" : key;
}

// The band's hint items for one group: runs of three or more digit-free consecutive keys that
// share a command (h j k l, the 1–9 tab keys) become one item; every other key is its own item.
// `label` is the first word of the first label, lowercased ("Focus left" -> "focus").
export function hintItems(group) {
  const rows = rowsFor(group);
  const items = [];
  let i = 0;
  while (i < rows.length) {
    const e = rows[i];
    let j = i + 1;
    if (!e.mode) {
      while (j < rows.length && sameRun(e, rows[j])) j++;
    }
    if (j - i >= 3) {
      const run = rows.slice(i, j);
      items.push({ keys: run.map((r) => r.key), text: runText(run), label: firstWord(e.label) });
      i = j;
    } else {
      items.push({ keys: [e.key], text: keyLabel(e.key), label: firstWord(e.label) });
      i += 1;
    }
  }
  return items;
}

// Two entries share a hint item when they run the same command: the four focus keys differ only
// in direction, and the tab keys only in index. A key with a mode or no command never merges.
function sameRun(a, b) {
  return !a.mode && !b.mode && Boolean(a.command) && a.command === b.command && a.group === b.group;
}

// "h j k l", or "1–9" for consecutive digits.
function runText(run) {
  const keys = run.map((r) => r.key);
  if (keys.every((k, n) => /^[0-9]$/.test(k) && Number(k) === Number(keys[0]) + n)) return `${keys[0]}–${keys.at(-1)}`;
  return keys.map(keyLabel).join(" ");
}

function firstWord(label) {
  return String(label ?? "").split(" ")[0].toLowerCase();
}

// The band's map state: the hint lines, one list of items per group.
export function mapBandState() {
  return {
    v: 1,
    mode: "map",
    lines: HINT_LINES.map((gs) => gs.map((g) => ({ group: g, items: hintItems(g) }))),
    note: "Esc cancels",
  };
}

// The band's resize state: sidebar and panel, each with its key pair, and the live sizes.
// `sizes` is { sidebar, panel } (px, or null when unknown) and is passed through.
export function resizeBandState(sizes) {
  const pairs = [
    { keys: ["h", "l"], label: "sidebar −40 +40" },
    { keys: ["H", "L"], label: "panel +40 −40" },
    { keys: ["j", "k"], label: "agents/focus divider down up" },
    { keys: ["J", "K"], label: "spaces/agents divider down up" },
  ];
  const items = pairs.map((p) => ({ keys: p.keys, text: p.keys.join(" "), label: p.label }));
  return {
    v: 1,
    mode: "resize",
    lines: [[{ group: "Resize", items }]],
    note: "Esc done",
    sizes: { sidebar: sizes?.sidebar ?? null, panel: sizes?.panel ?? null },
  };
}

// Whether the band is in the layout and shown: the ai-spend node exists and is not hidden.
export function hasBand(root) {
  const band = findNode(root, BAND_ID);
  return Boolean(band) && !band.hidden;
}

// ----------------------------------------------------------------- resize

export const SIDEBAR = { id: "sidebar", min: 44, max: 480, start: 268 };
export const PANEL = { id: "panel", min: 280, max: 900, start: 368 };
export const RESIZE_STEP = 40;

// The next size for a node: current + delta, clamped to its min and max. A non-finite input
// keeps the current size (never NaN in a layout).
export function nextSize(current, delta, min, max) {
  const base = Number.isFinite(current) ? current : min;
  const next = base + (Number.isFinite(delta) ? delta : 0);
  return Math.min(max, Math.max(min, Math.round(next)));
}

// The resize key's effect: which node, and the new px. Keys h/l resize the sidebar, H/L the
// panel. Returns null for any other key.
export function resizeTarget(key) {
  if (key === "h") return { node: SIDEBAR, delta: -RESIZE_STEP };
  if (key === "l") return { node: SIDEBAR, delta: RESIZE_STEP };
  if (key === "H") return { node: PANEL, delta: RESIZE_STEP };
  if (key === "L") return { node: PANEL, delta: -RESIZE_STEP };
  return null;
}

// The sidebar's stacked blocks, top to bottom, sized by weight. Defaults match layouts/herdr-pi.json.
export const SIDEBAR_BLOCKS = { spaces: 1, agents: 2, focus: 1 };
export const WEIGHT_STEP = 0.25;
export const WEIGHT_MIN = 0.25;

// Up/down keys move a divider between two sidebar blocks: j/k the one between agents and focus,
// J/K the one between spaces and agents. Down (j, J) grows the block above. Null for other keys.
export function dividerTarget(key) {
  if (key === "j") return { above: "agents", below: "focus", delta: WEIGHT_STEP };
  if (key === "k") return { above: "agents", below: "focus", delta: -WEIGHT_STEP };
  if (key === "J") return { above: "spaces", below: "agents", delta: WEIGHT_STEP };
  if (key === "K") return { above: "spaces", below: "agents", delta: -WEIGHT_STEP };
  return null;
}

// The pair's new weights after moving their divider by delta. The pair's sum is kept, so the other
// blocks keep their share; neither side goes below WEIGHT_MIN. A non-finite weight reads as min.
export function shiftWeights(above, below, delta) {
  const a = Number.isFinite(above) ? above : WEIGHT_MIN;
  const b = Number.isFinite(below) ? below : WEIGHT_MIN;
  const d = Number.isFinite(delta) ? delta : 0;
  const next = Math.min(a + b - WEIGHT_MIN, Math.max(WEIGHT_MIN, a + d));
  return [next, a + b - next];
}

// The weight a node is sized by in a layout tree, or null when it has no weight.
export function weightOf(root, id) {
  const node = findNode(root, id);
  return typeof node?.size?.weight === "number" ? node.size.weight : null;
}

// ----------------------------------------------------------------- panels

// What a panel key does, from the panel's state. `state` is { open, active } where `open`
// is whether the panel node is shown and `active` is the stack child showing (or null).
// `child` is "files" | "changes" | "other". Returns the list of commands to run in order.
//
//   closed                     → open on child                (e / c / Tab does nothing)
//   open, showing child        → hide the panel
//   open, showing the other    → switch to child
//   Tab "other" while open     → switch to the other child
//   Tab "other" while closed   → nothing
export function panelAction(state, child, otherOf = (c) => (c === "files" ? "changes" : "files")) {
  const open = Boolean(state?.open);
  const active = state?.active ?? null;
  if (child === "other") {
    if (!open) return [];
    const target = otherOf(active ?? "files");
    return [{ command: "layout.select", args: { stack: "panel-body", child: target } }];
  }
  if (open && active === child) return [{ command: "layout.hide", args: { id: "panel" } }];
  const select = { command: "layout.select", args: { stack: "panel-body", child } };
  const show = { command: "layout.show", args: { id: "panel" } };
  return open ? [select] : [select, show];
}

// ------------------------------------------------------------- layout reading

// The node with this id in a layout tree (from layout()), or null.
export function findNode(root, id) {
  if (!root || typeof root !== "object") return null;
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const hit = findNode(child, id);
    if (hit) return hit;
  }
  return null;
}

// The panel's state for panelAction: whether the panel node is shown, and which stack child
// is active. A layout without the panel gives { open: false, active: null }.
export function panelState(root) {
  const panel = findNode(root, "panel");
  if (!panel) return { open: false, active: null };
  const body = findNode(panel, "panel-body");
  return { open: !panel.hidden, active: body?.active ?? null };
}

// The px a node is sized to in a layout tree, or null when it has no fixed px.
export function sizeOf(root, id) {
  const node = findNode(root, id);
  return typeof node?.size?.px === "number" ? node.size.px : null;
}

// Whether the active layout is herdr-pi, the only layout the resize keys apply to.
export function isHerdrPi(name) {
  return name === "herdr-pi";
}
