// Pure logic for the band's PR chip: no herdr or gpui imports, so the tests can load it.
// A port of session-band's draft-prs.ts (GH_ARGV, rollup, pickPrs, prLine), GitHub only.

// The gh argv (after `gh`). Merged and closed PRs come back too; prSummary keeps the open ones.
export const PR_ARGV = ["pr", "list", "--state", "all", "--limit", "30", "--json", "number,title,headRefName,url,isDraft,state,mergedAt,updatedAt,statusCheckRollup"];

// Shown lines are capped so the tooltip stays short.
const MAX_LINES = 6;
const RUN_FAILED = ["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE"];

// A StatusContext has `state`; a CheckRun has `status` and `conclusion`.
function failedCheck(c) {
  if (typeof c.state === "string") return c.state === "FAILURE" || c.state === "ERROR";
  return RUN_FAILED.includes(String(c.conclusion));
}

// Any failing check on the PR's rollup means the PR is failing.
function failing(items) {
  if (!Array.isArray(items)) return false;
  return items.some((c) => c && typeof c === "object" && failedCheck(c));
}

const str = (value) => (typeof value === "string" ? value : "");

// One gh PR as a row: `#<number> <title>`, cut to fit a tooltip line.
function prLine(pr) {
  const title = str(pr.title).replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, "") || str(pr.title);
  const cut = title.length > 44 ? `${title.slice(0, 43)}…` : title;
  return `${pr.draft ? "⑂" : " "} #${pr.number} ${cut}`;
}

// `gh pr list` stdout, as the band's PR chip: open drafts and ready PRs, whether any open PR has a
// failing check, and up to six lines for the tooltip. Merged and closed PRs are not counted.
// Returns { error } when the output is not a PR list.
export function prSummary(stdout) {
  let list;
  try {
    list = JSON.parse(typeof stdout === "string" ? stdout : "");
  } catch {
    return { error: "gh printed something that is not a PR list" };
  }
  if (!Array.isArray(list)) return { error: "gh printed something that is not a PR list" };
  const open = list.filter((p) => p && typeof p === "object" && p.state === "OPEN");
  const drafts = open.filter((p) => p.isDraft === true);
  const ready = open.filter((p) => p.isDraft !== true);
  return {
    drafts: drafts.length,
    ready: ready.length,
    failing: open.some((p) => failing(p.statusCheckRollup)),
    lines: open.slice(0, MAX_LINES).map((p) => prLine({ number: p.number, title: p.title, draft: p.isDraft === true })),
  };
}
