// The leader key (cmd-k): a small overlay that lists the keys and runs one command per press.
// Opened and closed by `mod.open:leader`, so cmd-k twice cancels. Pure logic (the key map,
// resolveKey, the step math, the panel decision) lives in ./logic.js and is tested in Node.
//
// Resize mode (r) keeps the overlay open: h/l move the sidebar, H/L the panel, until Escape or
// any other key. Each step starts from the node's live size in layout().

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { props, run, layout, closeOverlay, shared, setShared, theme, notify } from "herdr";
import {
  GROUPS, BAND_ID, BAND_PX, BAND_HINTS_PX, rowsFor, resolveKey, resizeTarget, nextSize, panelAction,
  panelState, sizeOf, isHerdrPi, keyLabel, mapBandState, resizeBandState, hasBand,
} from "./logic.js";

export default class Leader extends View {
  init(_p, cx) {
    this.handle = cx.focus_handle();
    this.mode = "map";
    this.surface = props()?.surface === "band" ? "band" : "popup";
    this.handle.focus();
    if (this.surface === "band") {
      setShared("leader.band", mapBandState());
      // Grow the band to two hint lines, if it is in this layout.
      if (hasBand(this.layoutTree())) run("layout.resize", { id: BAND_ID, px: BAND_HINTS_PX });
    }
  }

  // The band surface closes into the band: clear the shared state and shrink the band back.
  // Runs on every close, including a crash-free Esc. Popup surface has nothing to clear.
  async close() {
    if (this.surface !== "band") return;
    setShared("leader.band", null);
    setShared("leader.overlay", null);
    if (hasBand(this.layoutTree())) run("layout.resize", { id: BAND_ID, px: BAND_PX });
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

  // Entering resize mode. On the band surface the band shrinks back to one line, and the band
  // shows the live sizes instead of the map.
  enterResize(cx) {
    this.mode = "resize";
    if (this.surface === "band") {
      this.publishResize();
      run("layout.resize", { id: BAND_ID, px: BAND_PX });
    }
    cx.notify();
  }

  // Publishes the resize state with the live panel and sidebar sizes.
  publishResize() {
    const tree = this.layoutTree();
    setShared("leader.band", resizeBandState({ sidebar: sizeOf(tree, "sidebar"), panel: sizeOf(tree, "panel") }));
  }

  // Resize mode: one step per press from the node's live size (so a drag in between is kept).
  // Any other key closes. A shifted letter may arrive as "h" with shift, so normalise it.
  resize(event, cx) {
    const key = event.modifiers?.shift && /^[a-z]$/.test(event.key) ? event.key.toUpperCase() : event.key;
    const target = resizeTarget(key);
    if (!target) { closeOverlay(props().overlay); return; }
    if (!isHerdrPi(shared("layout"))) {
      notify({ title: "Resize works in herdr-pi", level: "info", timeout: 4000 });
      closeOverlay(props().overlay);
      return;
    }
    const { node, delta } = target;
    const current = sizeOf(this.layoutTree(), node.id) ?? node.start;
    run("layout.resize", { id: node.id, px: nextSize(current, delta, node.min, node.max) });
    if (this.surface === "band") this.publishResize();
    cx.notify();
  }

  onKey(event, cx) {
    if (event.key === "escape") { closeOverlay(props().overlay); return; }
    if (this.mode === "resize") { this.resize(event, cx); return; }
    const entry = resolveKey(event);
    if (!entry) { closeOverlay(props().overlay); return; }
    if (entry.mode === "resize") { this.enterResize(cx); return; }
    if (entry.mode === "panel") { this.panel(entry, cx); return; }
    this.dispatch(entry, cx);
  }

  render() {
    const t = theme();
    // The band surface draws nothing: the band (ai-spend) shows the hints, and this copy only
    // holds the keyboard.
    if (this.surface === "band") {
      return div().id("leader").size_full().track_focus(this.handle)
        .on_key_down((e, cx) => { cx.stop_propagation(); this.onKey(e, cx); });
    }
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
