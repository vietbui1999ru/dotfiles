// The leader key (cmd-k): a small overlay that lists the keys and runs one command per press.
// Opened and closed by `mod.open:leader`, so cmd-k twice cancels. Pure logic (the key map,
// resolveKey, the step math, the panel decision) lives in ./logic.js and is tested in Node.
//
// Resize mode (r) keeps the overlay open: h/l move the sidebar, H/L the panel, until Escape or
// any other key. Its sizes are kept in shared("leader.sizes") and start from herdr-pi.json.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, layout, closeOverlay, shared, setShared, readTextFile, theme, notify, home, exec } from "herdr";
import { GROUPS, rowsFor, resolveKey, resizeTarget, nextSize, panelAction, panelState, sizeOf, isHerdrPi, SIDEBAR, PANEL } from "./logic.js";

const PI_LAYOUT = (home) => `${home}/.config/herdr-app/layouts/herdr-pi.json`;

// The name of the layout the window shows, from `herdr-app status` ("" when it cannot be read).
async function shownLayout() {
  const r = await exec("herdr-app", ["status"], { timeout: 5000 }).catch(() => null);
  try { return JSON.parse(r?.stdout ?? "null")?.layout ?? ""; } catch { return ""; }
}

// The running px for each resizable node. Seeded from the herdr-pi layout file once, then
// kept in shared state so repeated presses (and a reopened overlay) continue from the last size.
async function currentSizes(home) {
  const known = shared("leader.sizes");
  if (known) return known;
  let sizes = { sidebar: SIDEBAR.start, panel: PANEL.start };
  try {
    const parsed = JSON.parse((await readTextFile(PI_LAYOUT(home))) ?? "null");
    sizes = { sidebar: sizeOf(parsed, "sidebar") ?? SIDEBAR.start, panel: sizeOf(parsed, "panel") ?? PANEL.start };
  } catch { /* no layout file: keep the defaults */ }
  setShared("leader.sizes", sizes);
  return sizes;
}

export default class Leader extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.mode = "map";
    this.handle.focus();
  }

  // Close this overlay first, then run the command, so a command that opens its own overlay
  // (workspaces.toggle, pi-fleet.new) is not stacked on the leader.
  dispatch(entry, cx) {
    closeOverlay(props().overlay);
    if (entry.command) run(entry.command, entry.args ?? {});
    cx.notify();
  }

  // Panel keys: read the layout's panel state, then run what panelAction says.
  panel(entry, cx) {
    closeOverlay(props().overlay);
    const commands = panelAction(panelState(this.layoutTree()), entry.child);
    for (const c of commands) run(c.command, c.args);
    cx.notify();
  }

  // The shown layout's tree. layout() is unknown-shaped; the panel state reads it defensively.
  layoutTree() {
    try { return layout(); } catch { return null; }
  }

  // Resize mode: one step per press, sizes kept in shared state. Any other key closes.
  async resize(key, cx) {
    const target = resizeTarget(key);
    if (!target) { closeOverlay(props().overlay); return; }
    if (!isHerdrPi(await shownLayout())) {
      notify({ title: "Resize works in herdr-pi", level: "info", timeout: 4000 });
      closeOverlay(props().overlay);
      return;
    }
    const sizes = await currentSizes(home());
    const name = target.node.id === "sidebar" ? "sidebar" : "panel";
    const px = nextSize(sizes[name], target.delta, target.node.min, target.node.max);
    setShared("leader.sizes", { ...sizes, [name]: px });
    run("layout.resize", { id: target.node.id, px });
    cx.notify();
  }

  onKey(event, cx) {
    if (event.key === "escape") { closeOverlay(props().overlay); return; }
    if (this.mode === "resize") { this.resize(event.key, cx); return; }
    const entry = resolveKey(event);
    if (!entry) { closeOverlay(props().overlay); return; }
    if (entry.mode === "resize") { this.mode = "resize"; cx.notify(); return; }
    if (entry.mode === "panel") { this.panel(entry, cx); return; }
    this.dispatch(entry, cx);
  }

  render() {
    const t = theme();
    const resizing = this.mode === "resize";
    return v_flex().id("leader").size_full().p(14).gap(8).bg(t.popover).border_1().border_color(t.border).rounded(10)
      .text_color(t.foreground).text_size(13).track_focus(this.handle)
      .on_key_down((e, cx) => { cx.stop_propagation(); this.onKey(e, cx); })
      .child(div().text_size(11).text_color(t.dim).child(resizing ? "Resize · h/l sidebar · H/L panel · Esc done" : "Leader · press a key · Esc cancels"))
      .when(!resizing, (el) => el.child(v_flex().gap(10).children(GROUPS.map((group) => groupBlock(group, t)))))
      .when(resizing, (el) => el.child(div().text_color(t.muted).child("Sidebar h smaller · l larger.  Panel H larger · L smaller.")));
  }
}

// One group of the map: its heading and one row per key (key, label).
function groupBlock(group, t) {
  const rows = rowsFor(group);
  if (!rows.length) return div();
  return v_flex().gap(3).child(div().text_size(10).font_semibold().text_color(t.dim).child(group.toUpperCase()))
    .child(v_flex().gap(2).children(rows.map((e) => h_flex().gap(10).child(div().w(34).font_semibold().text_color(t.accent).child(keyLabel(e.key))).child(div().text_color(t.muted).child(e.label)))));
}

// Shows a key the way it is pressed: the plain key name, with Tab spelled out.
function keyLabel(key) {
  return key === "Tab" ? "Tab" : key;
}
