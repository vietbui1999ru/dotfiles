// The Agents section of the sidebar: one list of every terminal agent (Claude, Codex, Pi,
// others) with Herdr's status, grouping and click-to-focus. A Pi run keeps its own second
// line (model, elapsed time) and its window, and its review actions sit in Needs review.
// Opened by herdr-pi.json as the one sidebar list. A copy opened with props { role: "new" }
// is the dialog instead (new-dialog.js): it runs no sync or command loop.
// Key commands (keys.json): pi-fleet.new opens the dialog, pi-fleet.next focuses the next run,
// pi-fleet.monitor opens the Pi monitor beside the focused pane.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import {
	agents,
	terminals,
	focused,
	panes,
	run,
	theme,
	openOverlay,
	shared,
	setShared,
	setAgentOrder,
	props,
	home,
	nextCommand,
	exec,
	hc,
	notify,
} from "herdr";
import { piRows, planSync, nextAddress, windowSpec, duration, reviewRows, approveMessage, cleanupRows, removeMessage, canClose, mergeAgentRows, displayedOrder } from "./logic.js";

// Opens a run's changes in the Changes panel: picks the run for it, then shows the panel.
function openRunChanges(run_) {
	setShared("pi-changes.run", run_);
	run("layout.select", { stack: "panel-body", child: "changes" });
	run("layout.show", { id: "panel" });
}
import { newDialog, newDialogState } from "./new-dialog.js";

// The agents mod's spinner and icon set, so this section reads like its neighbour.
const ICON = "mods/workspace-chrome";

const RANK = { blocked: 4, done: 3, working: 2, idle: 1 };
const SECTION = { 4: "Needs you", 3: "Done", 2: "Working", 1: "Idle" };
const SECTION_STATUS = { 4: "blocked", 3: "done", 2: "working" };
const SORTS = [
	{ id: "priority", label: "Priority", icon: "clock" },
	{ id: "grouped", label: "Grouped by space", icon: "layers" },
];
const sortOf = () => SORTS.find((s) => s.id === shared("agents.sort")) ?? SORTS[0];

// The agent's icon from the app's program table: a one-color glyph or a picture.
function icon(p, size, color) {
	if (!p?.icon) return null;
	return p.tint ? svg(p.icon).size(size).flex_none().text_color(color) : image(p.icon).w(size).h(size).flex_none();
}


export default class PiFleet extends View {
	init(_props, cx) {
		if (props()?.role === "new") {
			this.dialog = newDialogState(props());
			return;
		}
		this.opened = [];
		this.windowCount = 0;
		this.rows = [];
		this.agentList = [];
		this.changed = JSON.parse(localStorage.getItem("changed") ?? "{}");
		this.folded = new Set();
		this.hovered = null;
		this.reviews = [];
		this.cleanup = [];
		this.cleaning = false;
		this.removing = undefined;
		this.removeNote = undefined;
		this.sync(cx);
		cx.timer.every(2000, (cx) => this.sync(cx));
		cx.timer.every(30000, (cx) => cx.notify());
		this.readReviews(cx);
		cx.timer.every(60000, (cx) => this.readReviews(cx));
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
		this.agentList = agents();
		this.stamp(this.agentList, Date.now());
		cx.notify();
	}

	// Stamp each agent whose status changed, so its row can show how long it has been in
	// that state. Done and idle count as one: looking at a finished agent is not new work.
	stamp(list, now) {
		let dirty = false;
		for (const a of list) {
			const s = a.status === "done" ? "idle" : a.status;
			if (this.changed[a.address]?.s === s) continue;
			this.changed[a.address] = { s, at: now };
			dirty = true;
		}
		if (dirty) localStorage.setItem("changed", JSON.stringify(this.changed));
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

	// Pi-fleet.next: the Pi run after the focused terminal; the Pi list is the Pi runs only.
	focusNext() {
		const address = nextAddress(this.rows, focused()?.terminal);
		const row = this.rows.find((r) => r.address === address);
		if (row) this.focusRow(row);
		else notify({ title: "No Pi runs", timeout: 3000 });
	}

	// A non-Pi agent row: focus its pane, as Herdr's own list does.
	focusAgent(a) {
		run("pane.focus", { pane: a.pane });
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

	// One read at a time. A failed read keeps the last rows. The full list (not --offline)
	// is what finds squash-merged runs, so this read is slower.
	async readReviews(cx) {
		if (this.reviewBusy) return;
		this.reviewBusy = true;
		try {
			const r = await exec(`${home()}/dotfiles/scripts/agent-review`, ["list", "--global", "--json"], { timeout: 30000 });
			if (r.code === 0) {
				const entries = JSON.parse(r.stdout);
				this.reviews = reviewRows(entries);
				this.cleanup = cleanupRows(entries);
			}
		} catch {
			// Keep the last rows; the next read tries again.
		} finally {
			this.reviewBusy = false;
			cx.notify();
		}
	}

	// Two clicks: the first arms the button for 3 seconds, a second click inside that acts.
	arm(cx, key, onConfirm) {
		if (this.armed?.key === key) {
			this.armed = undefined;
			onConfirm();
			return;
		}
		const token = {};
		this.armed = { key, token };
		cx.notify();
		cx.timer.after(3000, (cx) => {
			if (this.armed?.token !== token) return;
			this.armed = undefined;
			cx.notify();
		});
	}

	// Remove one agent-review record with `skip`. One removal at a time; the row leaves the
	// list at once. The caller reads the list again when the run of removals ends.
	async removeOne(cx, row) {
		this.removing = row.runId;
		this.removeNote = undefined;
		cx.notify();
		let text = "Remove failed";
		try {
			const r = await exec(`${home()}/dotfiles/scripts/agent-review`, ["skip", row.runId], { cwd: row.cwd, timeout: 15000 });
			text = removeMessage(r.code, r.stdout);
		} catch {
			// A program that cannot start, or a timeout: not removed.
		}
		this.removing = undefined;
		if (text === null) {
			this.cleanup = this.cleanup.filter((r) => r.runId !== row.runId);
			return null;
		}
		return text;
	}

	// Remove one row, then re-read the list once.
	async removeRow(cx, row) {
		if (this.removing) return;
		const text = await this.removeOne(cx, row);
		if (text) this.showRemoveNote(cx, { runId: row.runId, text });
		await this.readReviews(cx);
	}

	// Remove every row oldest first. A refusal does not stop the rest; the note says how many went.
	async removeAll(cx) {
		if (this.removing) return;
		const rows = [...this.cleanup];
		let removed = 0;
		let first;
		for (const row of rows) {
			const text = await this.removeOne(cx, row);
			if (text === null) removed += 1;
			else if (first === undefined) first = text;
			cx.notify();
		}
		if (first !== undefined) this.showRemoveNote(cx, { runId: "all", text: `Removed ${removed} of ${rows.length}. ${first}` });
		await this.readReviews(cx);
	}

	showRemoveNote(cx, note) {
		this.removeNote = note;
		cx.timer.after(10000, (cx) => {
			if (this.removeNote !== note) return;
			this.removeNote = undefined;
			cx.notify();
		});
	}

	// Close a settled Pi run: Ctrl+D quits an idle Pi with an empty input, so a half-typed
	// message survives. Closing never approves anything.
	closePi(row) {
		hc(["keys", row.address, "ctrl+d"]).catch(() => {});
	}

	// One approve at a time. The macOS dialog it raises stays the person's last step.
	async approve(cx, row) {
		if (this.approving) return;
		this.approving = row.runId;
		this.approveNote = undefined;
		cx.notify();
		let text = "Approve failed";
		try {
			const r = await exec(`${home()}/dotfiles/scripts/agent-review`, ["approve", row.runId], { cwd: row.owner, timeout: 35000 });
			text = approveMessage(r.code, r.stdout);
		} catch {
			// A program that cannot start, or a timeout: not approved.
		}
		this.approving = undefined;
		const note = text ? { runId: row.runId, text } : undefined;
		this.approveNote = note;
		if (note) {
			cx.timer.after(10000, (cx) => {
				if (this.approveNote !== note) return;
				this.approveNote = undefined;
				cx.notify();
			});
		}
		await this.readReviews(cx);
	}

	textButton(t, id, label, enabled, onClick) {
		return div()
			.id(id)
			.flex_none()
			.text_size(11)
			.text_color(enabled ? t.accent : t.dim)
			.when(enabled, (el) => el.cursor_pointer().hover((s) => s.text_color(t.foreground)).on_click(onClick))
			.child(label);
	}

	reviewRow(t, row, now) {
		const started = Date.parse(row.startedAt);
		const waiting = this.approving === row.runId;
		const note = this.approveNote?.runId === row.runId ? this.approveNote.text : null;
		return v_flex()
			.px(8)
			.py(4)
			.gap(2)
			.child(
				h_flex()
					.gap(8)
					.items_center()
					.child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(row.name))
					.when(!Number.isNaN(started), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - started))))
					.child(this.textButton(t, `pi-diff-${row.runId}`, "Diff", true, () => openRunChanges({ runId: row.runId, cwd: row.owner, name: row.name })))
					.child(this.textButton(t, `pi-approve-${row.runId}`, waiting ? "Confirm in dialog…" : "Approve", !this.approving, (_e, cx) => cx.spawn((cx) => this.approve(cx, row)))),
			)
			.when(Boolean(note), (el) => el.child(div().text_size(11).text_color(t.blocked).child(note)));
	}

	cleanRow(t, row, now) {
		const started = Date.parse(row.startedAt);
		const busy = this.removing === row.runId;
		const note = this.removeNote?.runId === row.runId ? this.removeNote.text : null;
		return v_flex()
			.px(8)
			.py(4)
			.gap(2)
			.child(
				h_flex()
					.gap(8)
					.items_center()
					.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(row.name))
					.child(div().flex_none().text_size(11).text_color(t.dim).child(row.kind === "orphan" ? "No worktree" : "Landed"))
					.when(!Number.isNaN(started), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(duration(now - started))))
					.child(
						this.textButton(
							t,
							`pi-remove-${row.runId}`,
							busy ? "Removing…" : this.armed?.key === `row:${row.runId}` ? "Remove?" : "Remove",
							!this.removing,
							(_e, cx) => this.arm(cx, `row:${row.runId}`, () => cx.spawn((cx) => this.removeRow(cx, row))),
						),
					),
			)
			.when(Boolean(note), (el) => el.child(div().text_size(11).text_color(t.blocked).child(note)));
	}

	// A status mark drawn like the agents mod: a spinner, a ring for idle, a dot for done,
	// a "!" chip for blocked.
	mark(t, st) {
		if (st === "working") return svg(`${ICON}/spinner.svg`).size(12).mx(1).flex_none().text_color(t.working).spin(900);
		if (st === "blocked") return div().size(14).flex_none().rounded(4).bg(t.blocked + "26").text_size(10.5).font_bold().text_color(t.blocked).flex().items_center().justify_center().child("!");
		if (st === "idle") return div().size(7).mx(3).flex_none().rounded(4).border(1.5).border_color(t.idle ?? t.dim);
		return div().size(7).mx(3).flex_none().rounded(4).bg(t[st] ?? t.dim);
	}

	// The status word for a group's header row, as the agents mod shows it.
	status(t, a, compact = false) {
		if (a.status === "working") return this.mark(t, "working");
		if (a.status === "blocked" && compact) return this.mark(t, "blocked");
		if (a.status === "blocked") return div().flex_none().px(6).h(18).rounded(5).bg(t.blocked + "26").text_size(10.5).font_semibold().text_color(t.blocked).flex().items_center().child("Needs you");
		if (a.status === "idle") return this.mark(t, "idle");
		return div().size(7).mx(3).flex_none().rounded(4).bg(a.status === "done" ? t.done : t.dim + "00");
	}

	// Two lines for a Pi run: name (and machine) on top, model and elapsed time dim beneath.
	// A settled run shows Close at the right, which takes two clicks. Clicking the row
	// focuses the run's window (or its pane, when it is not a window).
	piRow(t, row, now, agent) {
		const st = row.status ?? agent?.status ?? "idle";
		const since = row.createdMs !== undefined ? duration(now - row.createdMs) : null;
		const detail = since ? `${row.model} · ${since}` : row.model;
		const armed = this.armed?.key === `close:${row.address}`;
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
			)
			.when(canClose(row), (el) =>
				el.child(
					div()
						.id(`pi-close-${row.address}`)
						.flex_none()
						.text_size(11)
						.text_color(t.dim)
						.cursor_pointer()
						.hover((s) => s.text_color(t.foreground))
						.on_click((_e, cx) => {
							// Keep the click from also focusing the row.
							cx.stop_propagation();
							this.arm(cx, `close:${row.address}`, () => this.closePi(row));
						})
						.child(armed ? "Close?" : "Close"),
				),
			);
	}

	// One non-Pi agent: its icon, name, status mark. Click focuses its pane.
	agentRow(t, a) {
		const pic = icon(a.program, 16, t.foreground);
		const idle = a.status === "idle" && !a.focused;
		const name = a.title || a.program?.name || a.address;
		return h_flex()
			.id(`ag-${a.address}`)
			.px(8)
			.h(30)
			.flex_none()
			.rounded(8)
			.items_center()
			.gap(9)
			.when(a.focused, (el) => el.bg(t.selected))
			.cursor_pointer()
			.hover((s) => s.bg(t.hover))
			.on_click(() => this.focusAgent(a))
			.when(Boolean(pic), (el) => el.child(pic))
			.child(div().flex_1().min_w(0).truncate().text_color(idle ? t.muted : t.foreground).child(name))
			.child(this.status(t, a, true));
	}

	// Rows under group headers, as the agents mod groups them: by priority section (Needs you,
	// Done, Working, Idle) or by space, in the order of the list. A folded group keeps its
	// header only. A Pi run uses piRow; any other agent uses agentRow.
	groupRows(t, ordered, now, byPriority) {
		const groupOf = (e) => {
			const agent = e.agent ?? { status: e.pi?.status ?? "idle" };
			return byPriority ? { id: `sec-${RANK[agent.status] ?? 1}`, label: SECTION[RANK[agent.status] ?? 1], status: SECTION_STATUS[RANK[agent.status] ?? 1] } : { id: `sp-${e.agent?.space ?? "pi"}`, label: e.agent?.space_name ?? "Pi runs", status: null };
		};
		const groups = [];
		for (const e of ordered) {
			const g = groupOf(e);
			const last = groups.at(-1);
			if (last?.id === g.id) last.members.push(e);
			else groups.push({ ...g, members: [e] });
		}
		return groups.flatMap((g) => [
			this.groupHeader(t, g),
			...(this.folded.has(g.id) ? [] : g.members.map((e) => (e.pi ? this.piRow(t, e.pi, now, e.agent) : this.agentRow(t, e.agent)))),
		]);
	}

	// A group's header: its label and count; click folds the group.
	groupHeader(t, g) {
		const open = !this.folded.has(g.id);
		return h_flex()
			.id(`grp-${g.id}`)
			.px(8)
			.pt(8)
			.h(30)
			.flex_none()
			.gap(6)
			.items_center()
			.text_size(11)
			.font_medium()
			.cursor_pointer()
			.hover((s) => s.text_color(t.foreground))
			.on_click((_e, cx) => {
				open ? this.folded.add(g.id) : this.folded.delete(g.id);
				cx.notify();
			})
			.child(div().truncate().text_color(t[g.status] ?? t.dim).child(g.label))
			.child(div().text_color(t.dim).child(String(g.members.length)));
	}

	// Nothing at all when no run is waiting or ready to clear.
	reviewSection(t, now) {
		if (this.reviews.length === 0 && this.cleanup.length === 0) return [];
		const out = [];
		if (this.reviews.length > 0) {
			out.push(
				h_flex()
					.px(8)
					.pt(12)
					.pb(4)
					.gap(6)
					.child(div().text_size(11.5).font_medium().text_color(t.dim).child("Needs review"))
					.child(div().text_size(11.5).text_color(t.blocked).child(String(this.reviews.length))),
				...this.reviews.map((row) => this.reviewRow(t, row, now)),
			);
		}
		if (this.cleanup.length > 0) {
			const toggle = this.cleaning ? "Done" : `Clean up ${this.cleanup.length}`;
			out.push(
				h_flex()
					.px(8)
					.pt(12)
					.pb(4)
					.gap(6)
					.items_center()
					.child(div().flex_1().text_size(11.5).font_medium().text_color(t.dim).when(this.reviews.length === 0, (el) => el.child("Clean up")))
					.child(
						this.textButton(t, "pi-cleanup", toggle, true, (_e, cx) => {
							this.cleaning = !this.cleaning;
							this.armed = undefined;
							cx.notify();
						}),
					),
			);
			if (this.cleaning) {
				out.push(
					v_flex()
						.px(8)
						.pb(4)
						.gap(2)
						.child(
							this.textButton(
								t,
								"pi-remove-all",
								this.armed?.key === "all" ? `Remove all ${this.cleanup.length}?` : `Remove all ${this.cleanup.length}`,
								!this.removing,
								(_e, cx) => this.arm(cx, "all", () => cx.spawn((cx) => this.removeAll(cx))),
							),
						)
						.when(this.removeNote?.runId === "all", (el) => el.child(div().text_size(11).text_color(t.blocked).child(this.removeNote.text))),
					...this.cleanup.map((row) => this.cleanRow(t, row, now)),
				);
			}
		}
		return out;
	}

	render() {
		const t = theme();
		if (props()?.role === "new") return newDialog(this, t);
		const now = Date.now();
		const sort = sortOf();
		const entries = mergeAgentRows(this.agentList, this.rows);
		const byPriority = sort.id === "priority";
		// Priority: the most urgent first, then the longest in state. The rank of a row is its
		// agent's status, or working/idle for a Pi run with no status yet.
		const rankOf = (e) => RANK[e.agent?.status ?? e.pi?.status ?? "idle"] ?? 1;
		const ordered = byPriority
			? [...entries].sort((x, y) => rankOf(y) - rankOf(x) || this.stamped(y) - this.stamped(x))
			: entries;
		setAgentOrder(displayedOrder(ordered));

		const header = h_flex()
			.px(16)
			.h(41)
			.pt(14)
			.pb(5)
			.flex_none()
			.items_center()
			.justify_between()
			.child(div().text_size(11.5).font_medium().text_color(t.dim).child("Agents"))
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
		const body = ordered.length
			? this.groupRows(t, ordered, now, byPriority)
			: [div().px(12).text_size(12).text_color(t.dim).child("No agents yet. Agents show up here when they report their status.")];
		return v_flex()
			.id("pi-fleet")
			.size_full()
			.min_h(0)
			.bg(t.chrome)
			.border_t(1)
			.border_color(t.border)
			.text_size(13)
			.child(header)
			.child(v_flex().id("pi-list").flex_1().min_h(0).px(8).overflow_y_scrollbar().mode("always").children([...body, ...this.reviewSection(t, now)]));
	}

	// When an agent's status last changed (ms), 0 when not seen yet.
	stamped(e) {
		const key = e.agent?.address ?? e.pi?.address;
		return this.changed[key]?.at ?? 0;
	}
}
