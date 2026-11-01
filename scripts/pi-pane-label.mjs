/**
 * The herdr pane label for a dispatched run: `pi#<task id> <slug>`.
 *
 * pueue gives a task no environment of its own, so `pi-view` finds the run by the
 * `--session-id` in its command instead. Usage, from `pi-view`:
 *
 *   pueue status --json | node scripts/pi-pane-label.mjs <session-id>
 *
 * Prints the slug alone when no Running task carries that session yet (pueue may not have
 * started it), so the pane always gets a name. `pi-view` retries until it has the id.
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

/**
 * `pi#184 pi-panes-958d` for session `pueue-pi-panes-958d`. With no task id (the pueue
 * lookup missed) the slug alone, so the pane is never left blank. Task id 0 is real.
 */
export const paneLabel = (taskId, sessionId) => {
	const slug = sessionId.replace(/^pueue-/, "");
	return taskId === undefined ? slug : `pi#${taskId} ${slug}`;
};

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
