// The Pi fleet strip: one item per Pi run, a + to start a new one, and the window
// sync. A copy opened with props { role: "new" } is the dialog instead (new-dialog.js):
// it runs no sync or command loop.
// Key commands (keys.json): pi-fleet.new opens the dialog, pi-fleet.next focuses the next run.

import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import {
	terminals,
	focused,
	run,
	theme,
	openOverlay,
	shared,
	setShared,
	props,
	home,
	nextCommand,
} from "herdr";
import { piRows, planSync, nextAddress, windowSpec } from "./logic.js";
import { newDialog, newDialogState } from "./new-dialog.js";

const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const GLYPH = { working: "●", blocked: "●", done: "●", idle: "○" };

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

	// Open a row's window (out of the dismissed list), then focus its terminal.
	focusRow(row) {
		const dismissed = shared("pi-fleet.dismissed") ?? [];
		if (dismissed.includes(row.address)) {
			setShared("pi-fleet.dismissed", dismissed.filter((a) => a !== row.address));
		}
		if (row.isWindow) {
			openOverlay(windowSpec(row.address, this.windowCount));
			this.windowCount += 1;
		}
		run("pane.focus", { terminal: row.address });
	}

	focusNext() {
		const address = nextAddress(this.rows, focused()?.terminal);
		const row = this.rows.find((r) => r.address === address);
		if (row) this.focusRow(row);
	}

	openNew() {
		openOverlay({
			mod: "pi-fleet",
			kind: "dialog",
			width: 520,
			props: { role: "new", folder: focused()?.cwd ?? home() },
		});
	}

	chip(t, row) {
		const st = row.status;
		return h_flex()
			.id(`pi-${row.address}`)
			.h_full()
			.px(8)
			.gap(5)
			.items_center()
			.rounded(6)
			.cursor_pointer()
			.hover((s) => s.bg(t.hover))
			.on_click(() => this.focusRow(row))
			.child(
				div()
					.text_color(t[st] ?? t.dim)
					.when(st === "working", (el) => el.frames(SPIN, 90))
					.child(GLYPH[st] ?? "·"),
			)
			.when(row.machine !== "local", (el) => el.child(div().text_color(t.dim).child(row.machine)))
			.child(div().text_color(t.foreground).child(row.name || row.address));
	}

	render() {
		const t = theme();
		if (props()?.role === "new") return newDialog(this, t);
		const plus = h_flex()
			.id("pi-new")
			.px(8)
			.h_full()
			.items_center()
			.rounded(6)
			.text_color(t.muted)
			.cursor_pointer()
			.hover((s) => s.bg(t.hover).text_color(t.foreground))
			.on_click(() => this.openNew())
			.child("+");
		const items = this.rows.length
			? this.rows.map((row) => this.chip(t, row))
			: [div().text_color(t.dim).child("No Pi runs")];
		return h_flex()
			.id("pi-fleet")
			.size_full()
			.px(8)
			.gap(6)
			.items_center()
			.bg(t.chrome)
			.text_size(12)
			.children(items)
			.child(div().flex_1())
			.child(plus);
	}
}
