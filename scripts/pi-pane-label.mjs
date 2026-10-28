/**
 * The herdr pane label for a dispatched run: `pi#<task id> <slug>`.
 *
 * pueue gives a task no environment of its own, so `pi-view` finds the run by the
 * `--session-id` in its command instead. Usage, from `pi-view`:
 *
 *   pueue status --json | node scripts/pi-pane-label.mjs <session-id>
 *
 * Prints nothing and exits 1 when no Running task carries that session, which is
 * every failure mode this needs: the caller then leaves the pane's label alone.
 */
import { parseStatus } from "../session-band-plugin/hooks/pueue.ts";
import { pathToFileURL } from "node:url";

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The run's own `--session-id`, however the dispatch quoted it. */
export const sessionFlag = sessionId => new RegExp(`--session-id[=\\s]+['"]?${escape(sessionId)}['"]?(?=\\s|$)`);

/** The id of the Running task dispatched for `sessionId`, or undefined. */
export const taskIdFor = (statusJson, sessionId) => {
	const flag = sessionFlag(sessionId);
	return parseStatus(statusJson).find(task => task.state === "Running" && flag.test(task.command))?.id;
};

/** `pi#184 pi-panes-958d` for session `pueue-pi-panes-958d`. */
export const paneLabel = (taskId, sessionId) => `pi#${taskId} ${sessionId.replace(/^pueue-/, "")}`;

const readStdin = async () => {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
};

const main = async ([sessionId]) => {
	if (!sessionId) {
		process.stderr.write("usage: pi-pane-label <session-id> < pueue-status.json\n");
		return 2;
	}
	const id = taskIdFor(await readStdin(), sessionId);
	if (id === undefined) return 1;
	process.stdout.write(`${paneLabel(id, sessionId)}\n`);
	return 0;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	try {
		process.exitCode = await main(process.argv.slice(2));
	} catch {
		process.exitCode = 1;
	}
}
