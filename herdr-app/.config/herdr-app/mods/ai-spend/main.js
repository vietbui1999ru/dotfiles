// The AI spend band: each subscription's quota windows and this week's cost, from
// `claude-tui status --json`. Polled once a minute; a click opens the claude-tui dashboard.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { exec, run, theme, focused, home, readTextFile } from "herdr";
import { attachedJob, bandModel, jobSession, resetText, terminalSegments } from "./format.js";

const POLL_MS = 60000;
// The focused terminal changes with focus, so it is read on a shorter tick than the quota poll.
const TERMINAL_MS = 3000;
// How long a terminal's attached-job lookup (one ps call) is reused.
const LOOKUP_MS = 30000;
// The status line's snapshot folder (claude/.claude/statusline-command.sh).
const STATE = () => `${home()}/.local/state/claude-tui`;
const COLOR = { normal: "muted", attention: "working", error: "blocked" };

export default class AiSpend extends View {
  init(_props, cx) {
    this.model = null;
    this.busy = false;
    this.terminal = null;
    this.sessions = new Map();
    this.poll(cx);
    this.pollTerminal(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    cx.timer.every(TERMINAL_MS, (cx) => this.pollTerminal(cx));
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

  // The focused Claude terminal's context, model and branch. Read on the same timer, but on its
  // own, so a failed quota call never hides them. Hidden when the focus is not a Claude terminal.
  pollTerminal(cx) {
    cx.spawn(async (cx) => {
      const terminal = focused()?.terminal ?? null;
      const now = Date.now();
      try {
        const plain = terminal && /^[A-Za-z0-9._-]+$/.test(terminal);
        const text = plain ? await readTextFile(`${STATE()}/by-terminal/${terminal}.json`) : null;
        let seg = terminalSegments(terminal, text, now);
        if (plain && !seg) seg = await this.attachedSegments(terminal, now);
        this.terminal = seg;
      } catch {
        this.terminal = null;
      } finally {
        cx.notify();
      }
    });
  }

  // A background job attached in this terminal, whose status line has no HC_TERMINAL_ID:
  // terminal -> `claude attach <job>` (ps) -> session id (the job's state.json) -> its by-session
  // snapshot. The mapping is cached per terminal and redone every LOOKUP_MS, so a plain shell does
  // not run ps on every tick and a re-attach to another job is picked up.
  async attachedSegments(terminal, now) {
    let hit = this.sessions.get(terminal);
    if (!hit || now - hit.at >= LOOKUP_MS) {
      const ps = await exec("ps", ["axeww", "-o", "command="], { timeout: 5000 }).catch(() => null);
      const job = attachedJob(ps?.code === 0 ? ps.stdout : "", terminal);
      const sid = job ? jobSession(await readTextFile(`${home()}/.claude/jobs/${job}/state.json`)) : null;
      hit = { sid, at: now };
      this.sessions.set(terminal, hit);
    }
    if (!hit.sid) return null;
    return terminalSegments(terminal, await readTextFile(`${STATE()}/by-session/${hit.sid}.json`), now);
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
    const focus = this.terminalStrip(t);
    if (!this.model) return band.children(focus);
    if (this.model.message) return band.px(10).text_color(t.dim).child(this.model.message);
    return band.children([
      ...focus,
      ...this.model.groups.flatMap((g, i) => [
        ...(i > 0 ? [div().h(14).w(1).flex_none().bg(t.border)] : []),
        this.group(t, g, now),
      ]),
    ]);
  }

  // The focused terminal's context, model and branch, as one run of text. Empty when hidden.
  terminalStrip(t) {
    const s = this.terminal;
    if (!s) return [];
    const parts = [s.ctx, s.model, s.branch].filter(Boolean);
    if (parts.length === 0) return [];
    return [
      div().id("spend-terminal").flex_none().px(10).whitespace_nowrap().text_color(t.muted).child(parts.join(" · ")),
      div().h(14).w(1).flex_none().bg(t.border),
    ];
  }
}
