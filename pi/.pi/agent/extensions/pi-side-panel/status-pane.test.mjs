// Run: node --test pi/.pi/agent/extensions/pi-side-panel/status-pane.test.mjs
// Pi launches the pane through the stow symlink (~/.pi/agent/extensions/...),
// so the entry check must survive a symlinked argv[1].
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

// main() always writes the .pi/panel.state.json heartbeat first, so its
// presence proves main() ran. Process lifetime does not: without a TTY or a
// watched .pi/status dir, main() renders once and exits normally.
test("main() runs when launched through a symlink", async () => {
	const dir = mkdtempSync(join(tmpdir(), "status-pane-"));
	const link = join(dir, "status-pane.mjs");
	symlinkSync(fileURLToPath(new URL("./status-pane.mjs", import.meta.url)), link);
	const child = spawn(process.execPath, [link, "--cwd", dir], { stdio: "ignore" });
	await Promise.race([new Promise((r) => child.once("exit", r)), new Promise((r) => setTimeout(r, 3000))]);
	child.kill();
	assert.ok(existsSync(join(dir, ".pi", "panel.state.json")), "no heartbeat: main() never ran");
});
