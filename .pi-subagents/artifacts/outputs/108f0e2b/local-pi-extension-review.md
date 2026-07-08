## Review

- Correct: Extension factories are generally lightweight: most expensive work is deferred to commands/events/tools rather than running at module load or factory registration. Evidence: commands are registered in `pi-gitview.ts:278-290`, `pi-obsidian.ts:702-755`, and `pi-control-plane.ts:307-321`; the HTTP server is started only from handlers at `pi-control-plane.ts:310-319`.
- Correct: UI-heavy commands check `ctx.hasUI` / TUI mode before opening custom overlays in the Neovim and Git viewers. Evidence: `neovim-cockpit.ts:435-452`, `neovim-cockpit.ts:480-496`, `pi-gitview.ts:226-243`.
- Correct: Several displayed outputs are width/row bounded. Evidence: `neovim-cockpit.ts:480-481` caps context panel to 80 lines; `pi-session.ts:457-464` truncates diff rows and caps widget output to 50 lines; `git-helpers.ts:325-328` caps history by configured depth.

## Prioritized findings

### High — Non-existent extension event: `model_changed`

- Evidence: `pi-statusline.ts:336-340` subscribes to `pi.on("model_changed", ...)` and updates `currentModel` from that event.
- API evidence: the installed Pi extension API overloads list event names in `src/extensibility/extensions/types.ts:964-1008`; `model_changed` is not present. A repository/package grep also found no `model_changed` event in Pi source.
- Impact: this handler will never run (or should fail type-checking against current docs), so the statusline model segment can remain empty/stale except when recomputed from other events.
- Smallest safe fix: remove the `model_changed` subscription and derive the model from `ctx.model` inside existing valid events (`session_start`, `turn_end`, `agent_end`) and the `/statusline` command, or subscribe to a documented event that actually carries model changes if one is added upstream.

### High — `/cockpit` command collision between two local extensions

- Evidence: `neovim-cockpit.ts:432-454` registers `/cockpit`; `pi-control-plane.ts:315-321` also registers `/cockpit`.
- API evidence: Pi command collection uses a `Map` keyed by command name (`runner.ts:470-482`) and command dispatch scans extensions in reverse order (`runner.ts:492-498`), so duplicate extension commands silently shadow one another depending on load order.
- Impact: one cockpit becomes unreachable or autocomplete/help can disagree with dispatch if load ordering changes. This directly conflicts with the requested “no command collisions” best practice.
- Smallest safe fix: keep `/control-plane` for the HTTP dashboard and rename/remove the alias (`/local-cockpit` or `/control-cockpit`), leaving `/cockpit` for the Neovim operator panel.

### High — `/plan` template command collides with Pi’s built-in `/plan`

- Evidence: `pi-session.ts:319-323` registers `templateCommand("plan", ...)`.
- API evidence: Pi skips extension commands whose names are reserved built-ins (`runner.ts:473-479`). Built-in `/plan` exists at `builtin-registry.ts:237-244`.
- Impact: the intended plan-template command is skipped or unavailable; users invoking `/plan` get built-in plan mode instead of the session/template workflow.
- Smallest safe fix: rename the extension command to a namespaced command such as `/session-plan`, `/spec-plan`, or `/obsidian-plan`. Keep `/plan` for the built-in agent mode.

### Medium — Control-plane server is long-lived, cwd-sticky, and lacks teardown

- Evidence: module-level `server`/`serverUrl` are declared at `pi-control-plane.ts:31-32`; `startControlPlane()` returns the existing URL without checking the current session cwd at `pi-control-plane.ts:279-280`; the route closure captures the first `ctx.cwd` at `pi-control-plane.ts:284-287`; no `session_shutdown` handler closes the server.
- Impact: after switching sessions/projects, the dashboard can keep serving the first cwd’s Commandr/Git/Obsidian state. It also leaves a long-running resource alive until process exit and can fail/hang on port conflicts because `listen` has no error path.
- Smallest safe fix: track the cwd used to create the server and either restart/rebind when cwd changes or make cwd an explicit request/session parameter. Add `pi.on("session_shutdown", ...)` to close the server and handle `listen` errors/reuse with a clear notification.

### Medium — Control-plane API has weak output limits and broad local data exposure

- Evidence: `/api/commandr/events` reads the whole `events.jsonl` then slices only by line count (`pi-control-plane.ts:96-111`); Obsidian history/diff return CLI stdout up to a 4 MiB buffer without truncation (`pi-control-plane.ts:158-169`, `pi-control-plane.ts:227-249`); `sendJson()` serializes the full body (`pi-control-plane.ts:67-69`).
- Impact: browser refreshes can serve multi-megabyte responses every 5 seconds, and large Commandr/Obsidian payloads may leak more local/session detail than intended to any process that can access `127.0.0.1:3340`.
- Smallest safe fix: add per-endpoint `limit` query parameters with conservative defaults, cap string fields/JSON response bytes, tail `events.jsonl` by bytes instead of reading the full file, and show “truncated” metadata.

### Medium — `obsidian_note` tool can write arbitrary absolute paths supplied by the model

- Evidence: the tool exposes `notePath`, `vault`, and `folder` parameters to the LLM (`pi-obsidian.ts:672-687`); `createObsidianNote()` resolves `params.notePath` directly (`pi-obsidian.ts:535-537`) and writes the file twice (`pi-obsidian.ts:589`, `pi-obsidian.ts:603`).
- API evidence: tool definitions support explicit approval tiers, with omitted approval defaulting to `"exec"` (`types.ts:436-439`).
- Impact: approval friction exists by default, but the tool surface is broader than its description (“Obsidian note”) because a model call can target any absolute path. This is a least-privilege issue and can surprise users.
- Smallest safe fix: validate `notePath` is inside the resolved vault, reject `..`/absolute paths unless a command-only path is used, and consider removing `vault`/`folder` from tool parameters or marking the tool `hidden`/`defaultInactive` if it should be invoked only intentionally. If retained, set `approval: "write"` explicitly.

### Medium — Read-only `nvim_context` tool omits an explicit read approval tier

- Evidence: `neovim-cockpit.ts:515-534` registers `nvim_context`; the tool only reads cached Neovim context in its execute path (`neovim-cockpit.ts:535-545` and following) but does not set `approval`.
- API evidence: omitted tool approval defaults to `"exec"` (`types.ts:436-439`).
- Impact: a read-only context tool is classified like code execution, which is unnecessarily broad and may reduce usability or obscure real write/exec tools.
- Smallest safe fix: add `approval: "read"` to `nvim_context`.

### Medium — `autoInjectSessionState` currently records state but injects nothing

- Evidence: `pi-session.ts:87-95` stores `activeSessionFile` in a local variable; `pi-session.ts:98-100` calls it on `session_start`; `activeSessionFile` is not read anywhere else in the extension.
- Impact: enabling `autoInjectSessionState` appears to have no user-visible or model-visible effect. This is a state-management drift issue.
- Smallest safe fix: either remove the unused option/variable or inject an explicit, bounded message/context block through a documented mechanism (for example a `before_agent_start` return/message or `pi.sendMessage(..., { deliverAs: "nextTurn" })`, depending on intended behavior).

### Low — Local control-plane page has fragile inline HTML/JS for note opening

- Evidence: `pi-control-plane.ts:190` builds `innerHTML` with note paths and an inline `onclick` string.
- Impact: paths are inserted as HTML rather than text, and the constructed `openNote(...)` call is fragile for encoded strings. Although note paths originate from local filenames, this is avoidable UI injection risk and can break note opening.
- Smallest safe fix: render note rows with DOM APIs (`textContent`, `addEventListener`) or escape with `JSON.stringify()` for inline arguments and HTML-escape visible paths.

### Low — Git browser refresh is recursive

- Evidence: choosing refresh calls `await showGitBrowser(pi, args, ctx); return;` from inside `showGitBrowser()` at `pi-gitview.ts:245-247`.
- Impact: repeated refreshes grow the async call chain unnecessarily. It is unlikely to be catastrophic in normal use but is avoidable.
- Smallest safe fix: wrap the browser body in a loop and `continue` on refresh instead of recursive re-entry.

## Opportunities to split/simplify

- Split `pi-session.ts` into smaller extensions/packages: session inbox commands, template/Obsidian creation commands, review/diff helpers. It currently owns unrelated slash commands from save/clear/resume through templates and diff rendering (`pi-session.ts:102-464`).
- Split `pi-control-plane.ts` out as an explicit opt-in package/tool. It starts a local HTTP server and exposes Commandr/Git/Obsidian APIs; that is a different trust/resource profile than passive UI/status extensions.
- Keep command names namespaced by domain (`nvim-*`, `obsidian-*`, `git-*`, `session-*`) except for one carefully chosen primary alias. Current broad names include `/git`, `/open`, `/review`, `/diff`, `/cockpit`.

## Residual risks

- `/Users/vietquocbui/dotfiles/plan.md` and `/Users/vietquocbui/dotfiles/progress.md` were requested but were not present, so no project-local plan/progress context could be reviewed.
- I used the locally installed Pi source/docs under `~/.bun/install/global/node_modules/@oh-my-pi/pi-coding-agent` as the extension API reference; I did not query external documentation.
- I did not run Pi with these extensions loaded because the task is review-only and some startup/command paths can write run history or open UI/browser resources.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Returned prioritized findings with severities and concrete file/line evidence across pi-statusline.ts, neovim-cockpit.ts, pi-control-plane.ts, pi-session.ts, pi-obsidian.ts, pi-gitview.ts, and Pi API source references."
    }
  ],
  "changedFiles": [
    ".pi-subagents/artifacts/outputs/108f0e2b/local-pi-extension-review.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "git -C /Users/vietquocbui/dotfiles status --short",
      "result": "passed",
      "summary": "Observed pre-existing unstaged docs change and untracked .pi-subagents/pi-control-plane files; no staged files."
    },
    {
      "command": "pi --help | head -80",
      "result": "passed",
      "summary": "Confirmed local Pi CLI is installed and available."
    },
    {
      "command": "grep/nl/read inspections of local extensions and installed Pi API source",
      "result": "passed",
      "summary": "Verified event names, command registration behavior, builtin /plan, tool approval defaults, and relevant extension line numbers."
    }
  ],
  "validationOutput": [
    "Reviewed 8 extension files under pi/.pi/agent/extensions/*.ts.",
    "Verified ExtensionAPI event list does not include model_changed.",
    "Verified duplicate /cockpit registration and builtin /plan collision behavior."
  ],
  "residualRisks": [
    "Requested plan.md and progress.md were absent.",
    "No runtime Pi extension load test was run to avoid review-only side effects.",
    "Findings use local installed Pi API docs/source rather than external online docs."
  ],
  "noStagedFiles": true,
  "diffSummary": "No source files modified; wrote the required review artifact only.",
  "reviewFindings": [
    "high: pi-statusline.ts:336 - subscribes to non-existent model_changed event.",
    "high: neovim-cockpit.ts:432 and pi-control-plane.ts:315 - duplicate /cockpit command collision.",
    "high: pi-session.ts:319 - /plan template command collides with built-in /plan and will be skipped.",
    "medium: pi-control-plane.ts:31-32,279-287 - long-lived server is cwd-sticky and lacks teardown.",
    "medium: pi-control-plane.ts:96-111,158-169,227-249 - control-plane endpoints lack robust truncation/output limits.",
    "medium: pi-obsidian.ts:672-687,535-537,589,603 - obsidian_note tool can write model-supplied absolute paths.",
    "medium: neovim-cockpit.ts:515-534 - read-only nvim_context tool omits explicit approval: read.",
    "medium: pi-session.ts:87-100 - autoInjectSessionState stores unused state and injects nothing.",
    "low: pi-control-plane.ts:190 - fragile inline HTML/JS for note rows.",
    "low: pi-gitview.ts:245-247 - refresh uses recursive re-entry."
  ],
  "manualNotes": "Review-only audit completed; source files intentionally left unchanged."
}
```
