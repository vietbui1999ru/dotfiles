// Pure logic for the Pi changes mod: whether a run is picked, the git refs a run's review
// lives under, and the arguments for its diff. No imports from `herdr` or `gpui-*`, so Node
// can test it (scripts/pi-changes-logic.test.mjs).

// A run id is the UUID agent-review writes into its refs and records. Checked before it becomes
// part of a ref name, so a hostile or malformed value never reaches git.
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The picked run, or null for the working-tree view. A value that is not a complete run
// (missing fields, or a run id that is not a lowercase UUID) is treated as no run.
export function runFrom(value) {
  if (!value || typeof value !== "object") return null;
  const { runId, cwd, name } = value;
  if (typeof runId !== "string" || !RUN_ID.test(runId)) return null;
  if (typeof cwd !== "string" || cwd === "") return null;
  return { runId, cwd, name: typeof name === "string" && name !== "" ? name : runId.slice(0, 8) };
}

// The two refs a run's review diffs between. `base` is taken when the run starts, `end` when
// it finishes. Returns null when the run id is not a valid UUID.
export function refsFor(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) return null;
  return { base: `refs/agent-review/${runId}/base`, end: `refs/agent-review/${runId}/end` };
}

// The git arguments that list a run's changed files, or show one of them. Both use the same
// read-only switches as the working-tree view, so a read writes nothing under .git.
export const RUN_READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];

export function rangeArgs(refs, path) {
  const range = [refs.base, refs.end];
  if (path === undefined) return [...RUN_READ, "diff", ...range, "--numstat", "-z", "--no-renames"];
  return [...RUN_READ, "diff", ...range, "--no-ext-diff", "--no-textconv", "--no-color", "--", path];
}
