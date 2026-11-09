// The Pi agents section of the sidebar: one two-line row per Pi run, a + to start a new
// one, a monitor button, and the window sync. Opened by herdr-pi.json beneath the agents
// mod. A copy opened with props { role: "new" } is the dialog instead (new-dialog.js): it
// runs no sync or command loop.
// Key commands (keys.json): pi-fleet.new opens the dialog, pi-fleet.next focuses the next run,
// pi-fleet.monitor opens the Pi monitor beside the focused pane.

import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
	terminals,
	focused,
	panes,
	run,
	theme,
	openOverlay,
	shared,
	setShared,
	props,
	home,
	nextCommand,
} from "herdr";
import { piRows, planSync, nextAddress, windowSpec, duration } from "./logic.js";
import { newDialog, newDialogState } from "./new-dialog.js";

// The agents mod's spinner and icon set, so this section reads like its neighbour.
const ICON = "mods/workspace-chrome";


export default class PiFleet extends View {
	init(_props, cx) {
		if (props()?.role === "new") {
			this.dialog = newDialogState(props());
			return;
		}
		this.opened = [];
		this.windowCount = 0;
		this.rows = [];
		this.sync(cx);
		cx.timer.every(2000, (cx) => this.sync(cx));
		cx.spawn(async (cx) => {
			for (;;) {
				const c = await nextCommand();
				if (c === "new") this.openNew();
				if (c === "next") this.focusNext();
				if (c === "monitor") this.openMonitor();
				cx.notify();
			}
		});
	}

	// Recompute the rows and open the window rows that are neither opened nor dismissed.
	sync(cx) {
		this.rows = piRows(terminals());
		const dismissed = shared("pi-fleet.dismissed") ?? [];
		const plan = planSync({ rows: this.rows, opened: this.opened, dismissed });
		for (const address of plan.open) {
			openOverlay(windowSpec(address, this.windowCount));
			this.windowCount += 1;
		}
		this.opened = plan.opened.concat(plan.open);
		if (plan.dismissed.length !== dismissed.length) setShared("pi-fleet.dismissed", plan.dismissed);
		cx.notify();
	}

	// A window row: take it out of the dismissed list and open its window; the person
	// clicks the window to type, since pane.focus cannot reach a window's terminal.
	// Any other row (a tab or split): focus its pane.
	focusRow(row) {
		if (row.isWindow) {
			const dismissed = shared("pi-fleet.dismissed") ?? [];
			if (dismissed.includes(row.address)) {
				setShared("pi-fleet.dismissed", dismissed.filter((a) => a !== row.address));
			}
			openOverlay(windowSpec(row.address, this.windowCount));
			this.windowCount += 1;
			return;
		}
		run("pane.focus", { terminal: row.address });
	}

	focusNext() {
		const address = nextAddress(this.rows, focused()?.terminal);
		const row = this.rows.find((r) => r.address === address);
		if (row) this.focusRow(row);
	}

	// Focus the Pi monitor if it is open, else split one in beside the focused pane.
	openMonitor() {
		const open = panes().find((p) => p.mod === "pi-monitor");
		if (open) run("pane.focus", { pane: open.pane });
		else run("pane.split", { direction: "right", mod: "pi-monitor" });
	}

	openNew() {
		openOverlay({
			mod: "pi-fleet",
			kind: "dialog",
			width: 520,
			props: { role: "new", folder: focused()?.cwd ?? home() },
		});
	}

	// A status mark drawn like the agents mod: a spinner, a ring for idle, a dot for done,
	// a "!" chip for blocked.
	mark(t, st) {
		if (st === "working") return svg(`${ICON}/spinner.svg`).size(12).mx(1).flex_none().text_color(t.working).spin(900);
		if (st === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
		if (st === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
		return div().size(7).mx(3).flex_none().rounded(4).bg(t[st] ?? t.dim);
	}

	// Two lines: name (and machine) on top, model and elapsed time dim beneath.
	row(t, row, now) {
		const st = row.status ?? "idle";
		const since = row.createdMs !== undefined ? duration(now - row.createdMs) : null;
		const detail = since ? `${row.model} · ${since}` : row.model;
		return h_flex()
			.id(`pi-${row.address}`)
			.px(8)
			.py(4)
			.gap(9)
			.items_center()
			.rounded(8)
			.cursor_pointer()
			.hover((s) => s.bg(t.hover))
			.on_click(() => this.focusRow(row))
			.child(h_flex().w(14).flex_none().items_center().justify_center().child(this.mark(t, st)))
			.child(
				v_flex()
					.flex_1()
					.min_w(0)
					.child(
						h_flex()
							.gap(5)
							.items_center()
							.child(div().min_w(0).truncate().text_color(st === "idle" ? t.muted : t.foreground).child(row.name || row.address))
							.when(row.machine !== "local", (el) => el.child(div().flex_none().text_size(10).text_color(t.dim).child(row.machine))),
					)
					.child(div().truncate().text_size(11).text_color(t.dim).child(detail)),
			);
	}

	render() {
		const t = theme();
		if (props()?.role === "new") return newDialog(this, t);
		const now = Date.now();
		const header = h_flex()
			.px(16)
			.h(41)
			.pt(14)
			.pb(5)
			.flex_none()
			.items_center()
			.justify_between()
			.child(div().text_size(11.5).font_medium().text_color(t.dim).child("Pi agents"))
			.child(
				h_flex()
					.gap(10)
					.items_center()
					.child(
						div()
							.id("pi-monitor")
							.text_size(11)
							.text_color(t.dim)
							.cursor_pointer()
							.hover((s) => s.text_color(t.foreground))
							.tooltip("Pi monitor")
							.on_click(() => this.openMonitor())
							.child(svg(`${ICON}/monitor.svg`).size(14)),
					)
					.child(
						div()
							.id("pi-new")
							.text_size(11)
							.text_color(t.dim)
							.cursor_pointer()
							.hover((s) => s.text_color(t.foreground))
							.tooltip("New Pi run")
							.on_click(() => this.openNew())
							.child(svg(`${ICON}/plus.svg`).size(14)),
					),
			);
		const body = this.rows.length
			? this.rows.map((row) => this.row(t, row, now))
			: [div().px(12).text_size(12).text_color(t.dim).child("No Pi runs yet.")];
		return v_flex()
			.id("pi-fleet")
			.size_full()
			.min_h(0)
			.bg(t.chrome)
			.border_t(1)
			.border_color(t.border)
			.text_size(13)
			.child(header)
			.child(v_flex().id("pi-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always").children(body));
	}
}
