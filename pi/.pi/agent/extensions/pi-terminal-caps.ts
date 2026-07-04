import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { deleteAllKittyImages, getCapabilities, setCapabilities } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// pi-tui unconditionally disables the kitty graphics protocol whenever $TMUX
// is set, regardless of the outer terminal, because image passthrough is
// unreliable under tmux in general. This setup already has
// `allow-passthrough on` plus kitty RGB terminal-features wired up in
// tmux.conf, so when the outer terminal really is kitty we re-enable it.
async function outerTerminalIsKitty(): Promise<boolean> {
	try {
		const { stdout } = await execFileAsync(
			"tmux",
			["display-message", "-p", "#{client_termname}"],
			{ timeout: 500 },
		);
		return stdout.trim().toLowerCase().includes("kitty");
	} catch {
		return false;
	}
}

export default function terminalCaps(pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		if (!process.env.TMUX) return; // pi's own detection already handles this case
		const caps = getCapabilities();
		if (caps.images) return; // already enabled somehow
		if (!(await outerTerminalIsKitty())) return;
		setCapabilities({ ...caps, images: "kitty", trueColor: true });
	});

	pi.on("session_shutdown", async () => {
		if (getCapabilities().images === "kitty") {
			process.stdout.write(deleteAllKittyImages());
		}
	});
}
