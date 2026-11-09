// The AI spend band: each subscription's quota windows and this week's cost, from
// `claude-tui status --json`. Polled once a minute; a click opens the claude-tui dashboard.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, run, theme } from "herdr";
import { bandModel, resetText } from "./format.js";

const POLL_MS = 60000;
const COLOR = { normal: "muted", attention: "working", error: "blocked" };

export default class AiSpend extends View {
  init(_props, cx) {
    this.model = null;
    this.busy = false;
    this.poll(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
  }

  // One call at a time: a slow claude-tui never stacks up behind the timer.
  poll(cx) {
    if (this.busy) return;
    this.busy = true;
    cx.spawn(async (cx) => {
      try {
        const r = await exec("claude-tui", ["status", "--json"], { timeout: 10000 }).catch(() => ({ code: 1, stdout: "" }));
        this.model = bandModel(r.code, r.stdout);
      } catch {
        this.model = bandModel(1, "");
      } finally {
        this.busy = false;
        cx.notify();
      }
    });
  }

  quota(t, q) {
    const color = q.dim ? t.dim : t[COLOR[q.level]];
    return div().flex_none().text_color(color).child(`${q.label} ${q.text}`);
  }

  group(t, g, now) {
    const tip = [
      ...g.raw.map((q) => resetText(q, now)),
      `7d ${g.week}`,
    ].join("\n");
    return h_flex()
      .id(`spend-${g.name}`)
      .flex_1()
      .min_w(0)
      .h_full()
      .gap(8)
      .items_center()
      .px(10)
      .whitespace_nowrap()
      .tooltip(tip)
      .child(div().flex_none().text_color(t.muted).child(g.name))
      .children(g.quotas.map((q) => this.quota(t, q)))
      .child(div().flex_none().text_color(t.dim).child(g.today));
  }

  render() {
    const t = theme();
    const now = Date.now();
    const band = h_flex()
      .id("ai-spend")
      .h(24)
      .w_full()
      .min_w(0)
      .items_center()
      .text_size(11.5)
      .bg(t.chrome)
      .border_t(1)
      .border_color(t.border)
      .cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => run("terminal.open", { argv: ["claude-tui"], place: "tab" }));
    if (!this.model) return band;
    if (this.model.message) return band.px(10).text_color(t.dim).child(this.model.message);
    return band.children(this.model.groups.flatMap((g, i) => [
      ...(i > 0 ? [div().h(14).w(1).flex_none().bg(t.border)] : []),
      this.group(t, g, now),
    ]));
  }
}
