// The "New Pi run" dialog: machine, folder, tier and task. Submit writes the task to
// ~/.local/state/pi-fleet and runs scripts/pi-spawn with it. Esc closes it, as in prompt.
// Opened by main.js with props { role: "new", folder }. Its state lives on the copy that
// draws it; newDialogState() is called from that copy's init.

import { div } from "gpui-kit";
import { h_flex, v_flex, InputState, Input, TextareaState, Textarea } from "gpui-base";
import { exec, machines, writeTextFile, props, closeOverlay, home } from "herdr";
import { taskFileName, spawnArgs } from "./logic.js";

const TIERS = ["high", "medium", "low"];

export function newDialogState(p) {
	const folder = InputState.new({ value: p?.folder ?? "" });
	const task = TextareaState.new({ placeholder: "What should Pi do?", rows: 5 });
	return {
		machine: "local",
		tier: "low",
		folder,
		task,
		error: null,
		busy: false,
	};
}

// Machines this dialog can start on: this computer, plus each ready remote.
function machineChoices() {
	const remote = machines()
		.filter((m) => m.name && m.layout === "ready")
		.map((m) => m.name);
	return ["local", ...remote];
}

function chip(t, id, label, selected, onClick) {
	return div()
		.id(id)
		.px(10)
		.h(26)
		.flex()
		.items_center()
		.rounded(6)
		.border_1()
		.border_color(selected ? t.accent : t.input)
		.bg(selected ? t.selected : t.raised)
		.text_color(selected ? t.foreground : t.muted)
		.text_size(12)
		.cursor_pointer()
		.hover((s) => s.bg(t.hover))
		.on_click(onClick)
		.child(label);
}

function label(t, text) {
	return div().pt(12).pb(6).text_size(11.5).text_color(t.dim).child(text);
}

// Refuse a submit with a reason the dialog shows, or start the run in a task.
function submit(view, cx) {
	const d = view.dialog;
	const text = d.task.value().trim();
	const folder = d.folder.value().trim();
	if (!text) {
		d.error = "Write a task first.";
		return;
	}
	if (!folder) {
		d.error = "Choose a folder.";
		return;
	}
	d.busy = true;
	d.error = null;
	cx.spawn(async (cx) => startRun(view, cx));
}

// Write the task file, then start pi-spawn. Close on success; on failure keep the dialog
// open with pi-spawn's own message (--on exits 2 until the machine mesh lands).
export async function startRun(view, cx) {
	const d = view.dialog;
	const text = d.task.value().trim();
	const folder = d.folder.value().trim();
	const dir = `${home()}/.local/state/pi-fleet`;
	const taskFile = `${dir}/${taskFileName(text, Date.now())}`;
	await exec("mkdir", ["-p", dir]);
	await writeTextFile(taskFile, text, null);
	const r = await exec(
		`${home()}/dotfiles/scripts/pi-spawn`,
		spawnArgs({ tier: d.tier, taskFile, folder, machine: d.machine }),
		{ timeout: 15000 },
	);
	d.busy = false;
	if (r.code !== 0) {
		d.error = (r.stderr || r.stdout || `pi-spawn exited ${r.code}`).trim();
		cx.notify();
		return;
	}
	closeOverlay(props().overlay);
}

// The dialog's element tree. `view` is the PiFleet instance, which owns the state.
export function newDialog(view, t) {
	const d = view.dialog;
	const choices = machineChoices();
	return v_flex()
		.id("pi-new-dialog")
		.on_key_down((e, cx) => {
			if (e.key === "escape") {
				closeOverlay(props().overlay);
				cx.stop_propagation();
			}
		})
		.w_full()
		.p(18)
		.gap(4)
		.bg(t.popover)
		.text_color(t.foreground)
		.text_size(13)
		.child(
			h_flex()
				.items_center()
				.child(div().flex_1().text_size(15).font_semibold().child("New Pi run"))
				.child(div().text_size(11).text_color(t.dim).child("Esc")),
		)
		.child(label(t, "Machine"))
		.child(
			h_flex().gap(6).children(
				choices.map((m) =>
					chip(t, `pi-m-${m}`, m, d.machine === m, (_e, cx) => {
						d.machine = m;
						cx.notify();
					}),
				),
			),
		)
		.child(label(t, "Folder"))
		.child(d.folder ? Input.new(d.folder).h(32).px(10).rounded(8).border_1().border_color(t.input).bg(t.background) : null)
		.child(label(t, "Tier"))
		.child(
			h_flex().gap(6).children(
				TIERS.map((tier) =>
					chip(t, `pi-t-${tier}`, tier, d.tier === tier, (_e, cx) => {
						d.tier = tier;
						cx.notify();
					}),
				),
			),
		)
		.child(label(t, "Task"))
		.child(Textarea.new(d.task).h(120).p(10).rounded(8).border_1().border_color(t.input).bg(t.background))
		.when(Boolean(d.error), (el) =>
			el.child(div().pt(8).text_size(12).text_color(t.blocked).child(d.error)),
		)
		.child(
			h_flex()
				.pt(14)
				.gap(8)
				.justify_end()
				.child(
					h_flex()
						.id("pi-new-cancel")
						.h(32)
						.px(14)
						.items_center()
						.rounded(8)
						.border_1()
						.border_color(t.input)
						.bg(t.raised)
						.cursor_pointer()
						.on_click(() => closeOverlay(props().overlay))
						.child("Cancel"),
				)
				.child(
					h_flex()
						.id("pi-new-start")
						.h(32)
						.px(14)
						.items_center()
						.rounded(8)
						.bg(t.solid)
						.text_color(t.solid_foreground)
						.cursor_pointer()
						.hover((s) => s.opacity(0.88))
						.on_click((_e, cx) => submit(view, cx))
						.child(d.busy ? "Starting…" : "Start"),
				),
		);
}
