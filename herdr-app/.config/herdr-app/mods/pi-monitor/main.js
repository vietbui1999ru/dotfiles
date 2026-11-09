// The Pi monitor: every Pi run on pueue, and the transcript of the one selected. Read-only:
// no kill, pause or approve here. It polls scripts/pi-monitor-feed.mjs every 3 seconds and
// never starts a second poll while one is running.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, home } from "herdr";
import { elapsed, tokens, cost, capLines, firstLine, OUTCOME_WORD } from "./format.js";

const POLL_MS = 3000;
const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GLYPH = { running: SPIN[0], queued: "○", paused: "‖", success: "●", review: "◐", killed: "✕", failed: "✕" };

// The theme colour for each outcome. Review reads in the attention colour.
const TONE = {
	running: "working",
	queued: "idle",
	paused: "dim",
	success: "done",
	review: "blocked",
	killed: "dim",
	failed: "blocked",
};

export default class PiMonitor extends View {
	init(_props, cx) {
		this.feed = undefined;
		this.selected = undefined;
		this.thinking = false;
		this.busy = false;
		this.poll(cx);
		cx.timer.every(POLL_MS, (cx) => this.poll(cx));
	}

	// One feed read at a time. A failed read keeps the last feed on screen.
	async poll(cx) {
		if (this.busy) return;
		this.busy = true;
		try {
			const r = await exec(`${home()}/dotfiles/scripts/pi-monitor-feed.mjs`, [], { timeout: 10000 });
			const parsed = JSON.parse(r.stdout || "{}");
			if (r.code === 0 && parsed && Array.isArray(parsed.tasks)) this.feed = parsed;
		} catch {
			// Keep the last good feed; the next poll tries again.
		} finally {
			this.busy = false;
			cx.notify();
		}
	}

	// The task shown in detail: the selection, else the feed's pick.
	detailTask() {
		const tasks = this.feed?.tasks ?? [];
		if (this.selected !== undefined) return tasks.find((t) => t.id === this.selected);
		return tasks.find((t) => t.outcome === "running") ?? tasks[0];
	}

	header(t) {
		const s = this.feed?.summary ?? { running: 0, queued: 0, review: 0, failed: 0, cost: 0 };
		const badge = (n, label, color) =>
			h_flex()
				.gap(5)
				.items_center()
				.px(8)
				.h(22)
				.rounded(6)
				.bg(color + "1a")
				.text_size(11.5)
				.child(div().font_semibold().text_color(color).child(String(n)))
				.child(div().text_color(t.muted).child(label));
		return h_flex()
			.px(16)
			.h(44)
			.flex_none()
			.gap(8)
			.items_center()
			.border_b(1)
			.border_color(t.border)
			.child(div().font_semibold().text_size(13).text_color(t.foreground).child("Pi monitor"))
			.child(div().flex_1())
			.child(badge(s.running, "running", t[TONE.running] ?? t.dim))
			.child(badge(s.queued, "queued", t.muted))
			.child(badge(s.review, "needs review", t[TONE.review] ?? t.dim))
			.child(badge(s.failed, "failed", t[TONE.failed] ?? t.dim))
			.child(div().pl(6).text_size(11.5).text_color(t.dim).child(cost(s.cost)));
	}

	// One card in the list: state glyph, #id, label, model, elapsed time, tokens and cost.
	card(t, task, now) {
		const on = this.selected === task.id || (this.selected === undefined && this.detailTask()?.id === task.id);
		const tone = t[TONE[task.outcome]] ?? t.dim;
		const glyph = GLYPH[task.outcome] ?? "●";
		const started = task.startMs;
		const end = task.endMs ?? now;
		const since = started ? elapsed(end - started) : "";
		return v_flex()
			.id(`pm-${task.id}`)
			.px(10)
			.py(8)
			.gap(4)
			.rounded(8)
			.border_1()
			.border_color(on ? t.accent : t.border)
			.bg(on ? t.selected : t.raised)
			.cursor_pointer()
			.hover((s) => s.bg(t.hover))
			.on_click((_e, cx) => {
				this.selected = task.id;
				cx.notify();
			})
			.child(
				h_flex()
					.gap(6)
					.items_center()
					.child(div().text_color(tone).when(task.outcome === "running", (el) => el.frames(SPIN, 90)).child(glyph))
					.child(div().flex_none().text_size(11).text_color(t.dim).child(`#${task.id}`))
					.child(div().flex_1().min_w(0).truncate().font_semibold().text_color(t.foreground).child(task.label || task.session || ""))
					.child(div().flex_none().text_size(11).text_color(tone).child(OUTCOME_WORD[task.outcome] ?? task.outcome)),
			)
			.child(
				h_flex()
					.gap(6)
					.items_center()
					.text_size(11)
					.child(div().px(6).h(18).flex().items_center().rounded(4).bg(t.hover).text_color(t.muted).child(task.model ?? "model?"))
					.child(div().text_color(t.dim).child(since))
					.child(div().flex_1())
					.child(div().text_color(t.dim).child(`${tokens(task.tokens)} tok`))
					.child(div().text_color(t.dim).child(cost(task.cost))),
			);
	}

	list(t, now) {
		const tasks = this.feed?.tasks ?? [];
		if (this.feed?.unavailable) return [div().p(16).text_size(12).text_color(t.dim).child("Pueue is not running")];
		if (tasks.length === 0) return [div().p(16).text_size(12).text_color(t.dim).child("No Pi runs yet")];
		return tasks.map((task) => this.card(t, task, now));
	}

	// One transcript line for an entry, as the spec's kinds.
	entry(t, e) {
		if (e.kind === "thinking") {
			if (!this.thinking) return null;
			return div().text_size(12).italic().text_color(t.dim).truncate().child(firstLine(e.text));
		}
		if (e.kind === "tool") {
			const [name, ...rest] = e.text.split(" ");
			return h_flex()
				.gap(6)
				.items_center()
				.child(div().flex_none().px(6).h(18).flex().items_center().rounded(4).bg(t.hover).text_size(11).font_semibold().text_color(t.accent).child(name))
				.child(div().min_w(0).truncate().font_mono().text_size(11.5).text_color(t.muted).child(rest.join(" ")));
		}
		if (e.kind === "output") {
			return v_flex()
				.pl(10)
				.border_l(1.5)
				.border_color(t.border)
				.children(capLines(e.text).map((line) => div().font_mono().text_size(11).text_color(t.dim).child(line)));
		}
		if (e.kind === "error") {
			return div()
				.pl(10)
				.border_l(2)
				.border_color(t.blocked)
				.text_color(t.blocked)
				.child(e.text);
		}
		return div().text_color(t.foreground).child(e.text);
	}

	detail(t, now) {
		if (this.feed?.unavailable) return div().p(24).text_color(t.dim).child("Pueue is not running");
		const task = this.detailTask();
		if (!task) return div().p(24).text_color(t.dim).child("No Pi runs yet");
		const entries = this.feed?.detail?.id === task.id ? this.feed.detail.entries : [];
		const tone = t[TONE[task.outcome]] ?? t.dim;
		const elapsedText = task.startMs ? elapsed((task.endMs ?? now) - task.startMs) : "";
		const toggle = div()
			.id("pm-thinking")
			.px(8)
			.h(22)
			.flex()
			.items_center()
			.rounded(5)
			.text_size(11)
			.text_color(this.thinking ? t.foreground : t.dim)
			.cursor_pointer()
			.hover((s) => s.bg(t.hover))
			.on_click((_e, cx) => {
				this.thinking = !this.thinking;
				cx.notify();
			})
			.child(this.thinking ? "Hide thinking" : "Show thinking");
		return v_flex()
			.size_full()
			.min_h(0)
			.child(
				v_flex()
					.px(16)
					.py(12)
					.gap(6)
					.flex_none()
					.border_b(1)
					.border_color(t.border)
					.child(
						h_flex()
							.gap(8)
							.items_center()
							.child(div().text_color(tone).child(OUTCOME_WORD[task.outcome] ?? task.outcome))
							.child(div().font_semibold().text_color(t.foreground).child(`#${task.id} ${task.label}`))
							.child(div().flex_1())
							.child(toggle),
					)
					.child(
						h_flex()
							.gap(10)
							.items_center()
							.text_size(11.5)
							.text_color(t.muted)
							.child(div().child(task.model ?? "model?"))
							.when(Boolean(task.effort), (el) => el.child(div().text_color(t.dim).child(task.effort)))
							.child(div().text_color(t.dim).child(elapsedText))
							.child(div().text_color(t.dim).child(`${task.tools} tools`))
							.child(div().text_color(t.dim).child(`${task.files} files`)),
					)
					.when(Boolean(task.activity), (el) =>
						el.child(div().truncate().font_mono().text_size(11.5).text_color(t.dim).child(task.activity)),
					),
			)
			.child(
				v_flex()
					.id("pm-transcript")
					.flex_1()
					.min_h(0)
					.px(16)
					.py(10)
					.gap(8)
					.overflow_y_scrollbar()
					.mode("always")
					.children(
						entries.length === 0
							? [div().text_color(t.dim).child("No transcript yet")]
							: entries.map((e) => this.entry(t, e)).filter(Boolean),
					),
			);
	}

	render() {
		const t = theme();
		const now = Date.now();
		return v_flex()
			.id("pi-monitor")
			.size_full()
			.min_h(0)
			.bg(t.background)
			.text_color(t.foreground)
			.text_size(13)
			.child(this.header(t))
			.child(
				h_flex()
					.flex_1()
					.min_h(0)
					.child(
						v_flex()
							.w(320)
							.flex_none()
							.min_h(0)
							.border_r(1)
							.border_color(t.border)
							.bg(t.chrome)
							.child(
								v_flex()
									.id("pm-list")
									.flex_1()
									.min_h(0)
									.p(8)
									.gap(6)
									.overflow_y_scrollbar()
									.mode("always")
									.children(this.list(t, now)),
							),
					)
					.child(this.detail(t, now).flex_1().min_w(0)),
			);
	}
}
