// The AI spend band: each subscription's quota windows and this week's cost, from
// `claude-tui status --json`. Polled once a minute; a click opens the claude-tui dashboard.

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, run, theme, focused, home, readTextFile, openOverlay, closeOverlay, nextCommand, shared, setShared, layout } from "herdr";
import { attachedJob, bandModel, bandPx, jobSession, leaderBand, resetText, terminalSegments } from "./format.js";
import { ctxLevel, fitChips, queueHeld, sendItOn } from "./chips.js";

const POLL_MS = 60000;
// The focused terminal changes with focus, so it is read on a shorter tick than the quota poll.
const TERMINAL_MS = 3000;
// The attention chips (queue held, send-it) are read on their own tick, one call in flight each.
const CHIPS_MS = 15000;
// Width the band's terminal strip and quotas take before the chips get the rest of the band.
const QUOTA_RESERVE_PX = 240;
const TERMINAL_RESERVE_PX = 200;
// How long a terminal's attached-job lookup (one ps call) is reused.
const LOOKUP_MS = 30000;
// The status line's snapshot folder (claude/.claude/statusline-command.sh).
const STATE = () => `${home()}/.local/state/claude-tui`;
const COLOR = { normal: "muted", attention: "working", error: "blocked" };
// The band's normal height. The leader grows it to two hint lines while cmd-k is open.
const BAND_PX = 24;

export default class AiSpend extends View {
  init(_props, cx) {
    this.model = null;
    this.busy = false;
    this.terminal = null;
    this.sessions = new Map();
    this.held = null;
    this.sendIt = false;
    this.width = null;
    this.chipsBusy = false;
    this.recover();
    this.poll(cx);
    this.pollTerminal(cx);
    this.pollChips(cx);
    cx.timer.every(POLL_MS, (cx) => this.poll(cx));
    cx.timer.every(TERMINAL_MS, (cx) => this.pollTerminal(cx));
    cx.timer.every(CHIPS_MS, (cx) => this.pollChips(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "leader") this.toggleLeader();
        cx.notify();
      }
    });
  }

  // Crash recovery: a leader that never closed leaves its shared state and a taller band behind.
  // Clear the state, and shrink the band back if it is not at its normal height.
  recover() {
    setShared("leader.band", null);
    setShared("leader.overlay", null);
    let tree = null;
    try { tree = layout(); } catch { tree = null; }
    const px = bandPx(tree);
    if (px !== null && px !== BAND_PX) run("layout.resize", { id: "ai-spend", px: BAND_PX });
  }

  // Opens the invisible band-surface leader (the keyboard holder), or closes it when it is open.
  toggleLeader() {
    const id = shared("leader.overlay");
    setShared("leader.overlay", null);
    if (id) {
      try { closeOverlay(id); return; } catch { /* stale id: the overlay is already gone */ }
    }
    setShared("leader.overlay", openOverlay({ mod: "leader", kind: "popup", frame: "none", width: 2, height: 2, props: { surface: "band" } }));
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

  // The queue held count (pueue) and the focused repo's send-it state. The repo is the focused
  // terminal's folder; a remote space has no local cwd, so it has no send-it chip.
  pollChips(cx) {
    if (this.chipsBusy) return;
    this.chipsBusy = true;
    cx.spawn(async (cx) => {
      try {
        const pue = await exec("pueue", ["status", "--json"], { timeout: 5000 }).catch(() => ({ code: 1, stdout: "" }));
        this.held = queueHeld(pue.code, pue.stdout);
        const cwd = focused()?.cwd ?? null;
        const root = cwd ? await exec("git", ["rev-parse", "--show-toplevel"], { cwd, timeout: 5000 }).catch(() => null) : null;
        const top = root?.code === 0 ? root.stdout.trim() : "";
        const text = top ? await readTextFile(`${top}/.claude/settings.local.json`) : null;
        this.sendIt = sendItOn(text);
      } catch {
        this.held = null;
        this.sendIt = false;
      } finally {
        this.chipsBusy = false;
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
    const hints = leaderBand(shared("leader.band"));
    if (hints) return this.hintBand(t, hints);
    const band = h_flex()
      .id("ai-spend")
      .h(BAND_PX)
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
    const chips = this.chipRow(t);
    const measure = (size) => { this.width = size.width; };
    if (!this.model) return band.on_size_change(measure).children([...focus, ...chips]);
    if (this.model.message) return band.px(10).text_color(t.dim).child(this.model.message);
    return band.on_size_change(measure).children([
      ...focus,
      ...chips,
      ...this.model.groups.flatMap((g, i) => [
        ...(i > 0 ? [div().h(14).w(1).flex_none().bg(t.border)] : []),
        this.group(t, g, now),
      ]),
    ]);
  }

  // The leader's hints, drawn in place of the band's content while cmd-k is open: one row per
  // line, each group a dim label then its keys and what they do. Resize mode ends with the sizes.
  hintBand(t, hints) {
    const lines = hints.lines.map((line) => h_flex().h(20).items_center().gap(18).whitespace_nowrap().overflow_hidden()
      .children(line.map((g) => h_flex().flex_none().gap(8).items_center()
        .child(div().w(56).flex_none().text_size(10).font_semibold().text_color(t.dim).child(g.group.toUpperCase()))
        .children(g.items.map((item) => h_flex().flex_none().gap(4)
          .child(div().font_semibold().text_color(t.accent).child(item.text))
          .child(div().text_color(t.muted).child(item.label)))))));
    const sizes = hints.sizes ? `sidebar ${hints.sizes.sidebar ?? "—"} · panel ${hints.sizes.panel ?? "—"}` : null;
    const note = [hints.note, sizes].filter(Boolean).join("   ");
    return v_flex().id("ai-spend").h_full().w_full().min_w(0).px(10).py(2).bg(t.chrome).border_t(1).border_color(t.border)
      .text_size(11.5).children([...lines, div().text_color(t.dim).child(note)]);
  }

  // The attention chips that have something to say: send-it (red) and the held Pi queue
  // (working). Each is a flex_none span; they drop by rank only when the band is narrow.
  chipRow(t) {
    const chips = [];
    if (this.sendIt) chips.push({ id: "send-it", text: "⇉ send-it", color: t.blocked });
    if (this.held) chips.push({ id: "pi-held", text: `π held ${this.held}`, color: t.working, click: () => run("pi-fleet.monitor") });
    if (chips.length === 0) return [];
    const kept = this.width === null ? chips : fitChips(chips, this.width, QUOTA_RESERVE_PX + TERMINAL_RESERVE_PX);
    if (kept.length === 0) return [];
    return [
      ...kept.map((chip) => {
        const el = div().id(`spend-${chip.id}`).flex_none().px(8).whitespace_nowrap().text_color(chip.color).child(chip.text);
        return chip.click ? el.cursor_pointer().on_click((_e, cx) => { cx.stop_propagation(); chip.click(); }) : el;
      }),
      div().h(14).w(1).flex_none().bg(t.border),
    ];
  }

  // The focused terminal's context, model and branch, as one run of text. Empty when hidden.
  terminalStrip(t) {
    const s = this.terminal;
    if (!s) return [];
    const rest = [s.model, s.branch].filter(Boolean);
    if (!s.ctx && rest.length === 0) return [];
    const ctxColor = t[ctxLevel(s.ctxPct) ?? "muted"];
    const parts = [
      ...(s.ctx ? [div().id("spend-ctx").flex_none().text_color(ctxColor).child(s.ctx)] : []),
      ...(rest.length ? [div().flex_none().child(rest.join(" · "))] : []),
    ];
    return [
      h_flex().id("spend-terminal").flex_none().px(10).gap(6).whitespace_nowrap().text_color(t.muted).children(parts.flatMap((p, i) => (i > 0 ? [div().flex_none().text_color(t.dim).child("·"), p] : [p]))),
      div().h(14).w(1).flex_none().bg(t.border),
    ];
  }
}
