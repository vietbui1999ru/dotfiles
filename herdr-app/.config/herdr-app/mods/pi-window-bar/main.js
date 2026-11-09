// The drag bar above a Pi window: status, name, machine, model, and two buttons.
// Dismiss (−) closes the window and leaves the run going. Kill (✕) asks twice.
// Props: { terminal, overlay }.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { terminals, run, theme, props, closeOverlay, shared, setShared } from "herdr";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const WORDS = { working: "working", blocked: "needs you", done: "finished", idle: "idle" };
const GLYPH = { working: SPIN[0], idle: "○", blocked: "●", done: "●" };

// Same as pi-fleet's logic.js modelFrom. Kept here because herdr-app check refuses
// an import that leaves this mod's folder.
function modelFrom(argv) {
  const i = argv.indexOf("--model");
  if (i === -1 || i + 1 >= argv.length) return "viewer";
  const id = argv[i + 1].replace(/:[^:/]*$/, "");
  const slash = id.lastIndexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

export default class PiWindowBar extends View {
  init(_props, _cx) {
    this.confirming = false;
  }

  term() {
    return terminals().find((t) => t.address === props()?.terminal);
  }

  // Remember the dismissal so fleet's sync does not reopen this window.
  dismiss() {
    const address = props()?.terminal;
    const list = shared("pi-fleet.dismissed") ?? [];
    if (!list.includes(address)) setShared("pi-fleet.dismissed", [...list, address]);
    closeOverlay(props()?.overlay);
  }

  // The first press arms the button for 3 seconds; a second press inside that time kills.
  kill(cx) {
    if (!this.confirming) {
      this.confirming = true;
      cx.timer.after(3000, (cx) => {
        this.confirming = false;
        cx.notify();
      });
      cx.notify();
      return;
    }
    this.confirming = false;
    run("terminal.kill", { terminal: props()?.terminal });
  }

  button(t, id, label, onClick) {
    return div()
      .id(id)
      .px(7)
      .py(1)
      .rounded(5)
      .text_color(t.muted)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_click(onClick);
  }

  render() {
    const t = theme();
    const k = this.term();
    const st = k?.status ?? null;
    const address = props()?.terminal ?? "";
    const name = (k?.name ?? "").replace(/^pueue-/, "") || address;
    const machine = address.includes("/") ? address.split("/")[0] : null;
    const model = k ? modelFrom(k.argv ?? []) : "";
    return h_flex()
      .size_full()
      .px(10)
      .gap(8)
      .items_center()
      .bg(t.surface)
      .border_b(1)
      .border_color(t.border)
      .text_size(12)
      .child(
        div()
          .w(12)
          .flex_none()
          .text_color(t[st] ?? t.dim)
          .when(st === "working", (el) => el.frames(SPIN, 90))
          .child(GLYPH[st] ?? "·"),
      )
      .child(div().truncate().font_semibold().text_color(t.foreground).child(name))
      .when(Boolean(machine), (el) => el.child(div().flex_none().text_color(t.dim).child(machine)))
      .child(div().truncate().text_color(t.dim).child(model))
      .when(Boolean(st), (el) => el.child(div().flex_none().text_color(t[st] ?? t.dim).child(WORDS[st] ?? st)))
      .child(div().flex_1())
      .child(this.button(t, "dismiss", "−", () => this.dismiss()))
      .child(this.button(t, "kill", this.confirming ? "kill?" : "✕", (_e, cx) => this.kill(cx)));
  }
}
