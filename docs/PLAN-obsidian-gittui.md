<!-- markdownlint-disable MD013 MD024 MD025 -->

# Plan: Obsidian Session Notes + Git TUI + Localhost Control Plane

Status: **DRAFT v2 — decisions incorporated, still for grilling before build.**

---

## Confirmed decisions from grill pass

### Obsidian/session notes

- Use **Obsidian CLI** as the primary open/create/history/diff path. Official docs name the command `obsidian`; if a local alias/wrapper named `obsidian-cli` exists, support it as fallback, but config default should be `obsidian`.
- Add Obsidian CLI enablement/verification to dotfiles provisioning:
  - macOS: Obsidian 1.12.7+ installer registers a symlink at `/usr/local/bin/obsidian`; Ansible should verify it and print the Settings → General → Command line interface remediation if missing.
  - Linux: Obsidian CLI registration copies the binary to `~/.local/bin/obsidian`; Ansible should verify PATH and document/manual-copy fallback from the Obsidian install directory.
  - This is not an npm/pipx dependency; it is bundled with official Obsidian and enabled from Obsidian settings.
- Main vault default is `/Users/vietquocbui/repos/Obsidian`.
- Also support per-repo/per-project vaults, especially `llm-wiki` and project-specific vault workflows.
- Notes should live under a **Sessions/** root in the selected vault, with Dataview-friendly subfolders:
  - `Sessions/Specs/`
  - `Sessions/Plans/`
  - `Sessions/Reviews/`
- Hook behavior: **yes** to interactive/user-visible capture flow, not purely silent. The hook should detect spec/plan/review intent and offer/start the note flow when appropriate.
- Context scope options:
  - `since-compaction` default
  - `full`
  - `n-entries`
- Review notes should **embed DiffViewer artifacts**, not only link them.
- Notes are **mutated/updated** over time, with an `n-history` record rather than always creating a new note.
- Chosen version-history strategy: use **official Obsidian File Recovery + official Obsidian CLI file-history commands**. Do **not** make a community plugin a required dependency. Candidate community plugin research is documented below, but the selected implementation is core/CLI-first.
- Embed actual `obsidian diff` output into updated notes when it is fast enough; otherwise include a clear skipped/timeout marker and the exact command to rerun.

### Git TUI

- Scope is **viewer + cleanup only**.
- Do **not** switch pi cwd/session by raw/manual TUI selection. The TUI may open/reveal paths. A separate agent-mediated action may ask pi/agents to operate inside a selected worktree, but must first verify repo state, detect dirty/untracked files, create a backup/checkpoint, and require confirmation before destructive cleanup.
- Agent worktree handoff should send a follow-up prompt telling pi to operate in the selected worktree, and should write a timestamped `session-paused`/handoff marker for the source worktree/session so failures can be traced and reverted.
- Stale threshold: 14 days default.
- History depth: 20 commits default.
- Default repo scope: **cwd repo only**
- Add multi-repo option/toggle.
- Implement as a new extension file plus shared git helpers:
  - `pi-gitview.ts`
  - `git-helpers.ts`

### Additional requirement

- Add a **localhost web surface** that follows Commandr's `.agents/` bus protocol and DiffViewer's event/streaming model.
- Think: local cockpit/control-plane web page that reads Commandr bus state, follows DiffViewer stream/turn artifacts, and exposes safe viewer/control actions.

---

## Current state

### Existing pi extension state

`~/.pi/agent/extensions/pi-session.ts` already owns:

- `/spec`, `/plan`, `/design`, `/arch`, `/pr` — create docs from templates in `~/dotfiles/shared/templates/` by calling `~/dotfiles/scripts/agent-session save ...`.
- `/review` — points at `.diffviewer/artifacts/...`.
- `/open <file> [--app obsidian|nvim]` — currently tries Obsidian via `obsidian-cli`.
- `/save-session`, `/clear-context`, `/sessions`, `/resume`, `/diff`.

`~/.config/agent-workflow/config.json` is the global config surface. Repo-local `.agent-workflow.json` can override.

### Session facts

- Pi sessions live at `~/.pi/agent/sessions/<slugified-cwd>/<timestamp>_<uuid>.jsonl`.
- `ctx.sessionManager` exposes `getEntries()`, `getBranch()`, `getLeafId()`, `getSessionFile()`.
- Useful entry types: messages, tool results, compactions, branch summaries, labels, model changes.
- High-signal context sources: latest compaction, branch path since compaction, labeled checkpoints, failed tool results, touched files.

### Commandr bus facts

Commandr defines a filesystem-native bus under the main checkout's `.agents/` directory:

```text
.agents/
  inbox/
  claimed/
  done/
  approvals/
  events.jsonl
  council/
  annotations/
```

Key constraints:

- Bus lives in the **main checkout**, not each worktree.
- `events.jsonl` is append-only JSONL.
- Defined events include `task_claimed`, `task_progress`, `task_complete`, `task_failed`, `session_end`, `council_verdict`, `task_annotation`.
- `bin/index refresh [repo...]` builds derived `~/.agents/index.json`; this is a cache, never source of truth.
- Annotation loop writes `.agents/annotations/<task>/<turn>-<seq>.json` and `task_annotation` events; injection is harness-side.

### Obsidian File Recovery / CLI facts

Official Obsidian docs say File Recovery is a core plugin that saves complete snapshots of `.md` and `.canvas` files at regular intervals. Defaults: snapshots are saved at least 5 minutes apart and kept for 7 days; both intervals are configurable under Settings → Core plugins → File recovery. Snapshots are stored in global settings outside the vault, keyed by absolute note path, are device-local, and are not a complete backup solution.

Useful official UI/CLI capabilities:

- File Recovery UI can copy or restore snapshots and has **Show changes** to display added/removed/modified content between snapshots.
- Official Obsidian CLI includes file history commands:
  - `obsidian diff path="..." from=1 to=3` — list/compare local File Recovery and Sync versions.
  - `obsidian history path="..."` — list File Recovery versions.
  - `obsidian history:read path="..." version=1` — read a local history version.
  - `obsidian history:restore path="..." version=1` — restore a local history version.
  - `obsidian history:open path="..."` — open File Recovery UI for a file.
- Official Obsidian CLI requires Obsidian 1.12.7+ installer and the app/CLI registration enabled.

Community plugin research:

- **Version History Diff**: supports Sync, File Recovery, and Git diffs, but its README warns it uses private APIs and may break. Not selected as a dependency.
- **Obsidian Git**: strong Git/source-control UI, but it expands scope into staging/commit/sync and recommends pairing with Version History Diff for detailed file history. Not selected for this plan.
- **Time Machine**: closest UI match if we choose a plugin route; it uses built-in File Recovery snapshots plus git commits, offers timeline slider, colored diffs, full/selective restore, and on-demand snapshots. Still not selected as a required dependency because official CLI already gives us stable history/diff hooks and we want our DiffViewer/control-plane UI to remain independent.

### DiffViewer facts

DiffViewer local server:

- Main server binds `127.0.0.1:3333`.
- Core endpoints include:
  - `POST /event`
  - `POST /turn-end`
  - `GET /stream` via SSE-style stream
  - `POST /steer`
  - `POST /annotate`
  - `GET /api/architecture`
- Mobile server optionally binds `127.0.0.1:3334` and has `/ws`, `/approve`, `/reject`, `/undo`.
- `src/broadcaster.js` is a simple fan-out broadcaster with `subscribe`, `unsubscribe`, `emit`.
- `src/sidecarWatcher.js` watches `.diffviewer/turns/<sessionId>/turn-N.json`, normalizes, broadcasts, then unlinks after successful broadcast.

This is the web/control-plane pattern to follow: file/bus artifacts are source of truth; localhost server projects/streams them; safe actions shell to canonical bus tools.

---

# Workstream A — Obsidian notes seeded from pi session context

## Goal

When we do specs, plans, PR descriptions, or reviews, create/open an Obsidian note that is seeded from the current pi session and then continues to update as the work evolves.

The note should be useful outside pi: searchable in Obsidian, Dataview-friendly, linked to the source session, project, git branch/worktree, Commandr task (if any), and DiffViewer artifact (for reviews).

## Extension shape

New file: `~/.pi/agent/extensions/pi-obsidian.ts`.

Responsibilities:

1. Register hook(s) for intent detection and context capture.
2. Register LLM tool `obsidian_note`.
3. Register user commands:
   - `/obsidian-note`
   - `/obsidian-open`
   - `/obsidian-update`
4. Export helper(s) for `pi-session.ts` so existing `/spec`, `/plan`, `/review` commands reuse the same implementation.

## Hook behavior

Primary hook: `before_agent_start`.

When the user prompt or slash command indicates spec/plan/review intent:

1. Build a context snapshot from `ctx.sessionManager`.
2. If `ctx.hasUI`, show a concise prompt/notification flow:
   - detected kind
   - proposed vault/folder
   - proposed title/slug
   - context mode default (`since-compaction`)
3. Create/open/update the note according to config and user choice.
4. Store a custom session entry `obsidian-snapshot` with the snapshot and note path so future turns can update the same note.

Guardrails:

- No blocking prompt in print/json mode.
- Never dump raw JSONL into the note.
- Redact likely secrets from tool output and env-like strings.
- Limit tool output summaries by default.

## Tool: `obsidian_note`

Parameters:

```ts
kind: "spec" | "plan" | "design" | "arch" | "pr" | "review" | "note"
title?: string
slug?: string
contextMode?: "snapshot" | "since-compaction" | "full" | "n-entries" | "none"
entryCount?: number              // used when contextMode = "n-entries"
notePath?: string                // update existing note if provided
historyLimit?: number            // n-history entries to retain
includeToolCalls?: boolean
includeErrors?: boolean
includeCompactionSummaries?: boolean
includeDiffViewerArtifact?: boolean
openAfter?: boolean
vault?: string
folder?: string
```

Behavior:

1. Resolve vault:
   - tool param
   - repo `.agent-workflow.json`
   - global `~/.config/agent-workflow/config.json`
   - default `/Users/vietquocbui/repos/Obsidian`
2. Resolve folder:
   - `spec/design/arch` → `Sessions/Specs`
   - `plan` → `Sessions/Plans`
   - `pr/review` → `Sessions/Reviews`
   - `note` → `Sessions/Inbox` or configurable
3. Resolve or create note path:
   - Mutate existing note when `notePath` or matching frontmatter identity exists.
   - Otherwise create `<YYYY-MM-DD>_<slug>.md`.
4. Render/update frontmatter:
   - `kind`
   - `title`
   - `created`
   - `updated`
   - `pi_session`
   - `pi_session_id`
   - `cwd`
   - `project`
   - `git_branch`
   - `git_head`
   - `worktree_path`
   - `commandr_task` if detectable
   - `diffviewer_artifact` if present
   - `tags`
5. Update body sections idempotently:
   - `## Goal`
   - `## Session Context`
   - `## Decisions`
   - `## Files / Commands / Errors`
   - `## DiffViewer Artifact` for reviews
   - `## Template` from `~/dotfiles/shared/templates/<kind>.md`
   - `## History` retaining last `n` update entries
   - `## Obsidian File Recovery` with latest embedded `obsidian diff` output when under timeout, plus the CLI commands needed to inspect note history/diff (`history`, `diff`, `history:open`) for this note path
6. Open via official Obsidian CLI (`obsidian open path=...`, or `obsidian create path=... content=... open overwrite` for create/update flows as appropriate).

Obsidian CLI command should be adapter-based, not hardcoded until verified. Plan:

- At runtime, probe `obsidian --help` once and cache capabilities; if missing, also try `obsidian-cli --help` for local wrapper compatibility.
- Prefer exact official command shapes:
  - `obsidian vault="<vault-name>" create path="Sessions/Plans/foo.md" content="..." open overwrite`
  - `obsidian vault="<vault-name>" open path="Sessions/Plans/foo.md"`
  - `obsidian vault="<vault-name>" history path="Sessions/Plans/foo.md"`
  - `obsidian vault="<vault-name>" diff path="Sessions/Plans/foo.md" from=1`
  - `obsidian vault="<vault-name>" history:open path="Sessions/Plans/foo.md"`
- If CLI cannot be found in non-login PATH, try a login shell path probe (`zsh -lc 'command -v obsidian || command -v obsidian-cli'`) and report official registration steps: Obsidian 1.12.7+, Settings → General → Command line interface, restart terminal.

## Skill: `obsidian-spec`

Location: `~/.agents/skills/obsidian-spec/SKILL.md`.

Description should trigger on spec/planning/reviewing with Obsidian/session context.

Instructions:

- Use `obsidian_note` when user begins spec, plan, design, arch, PR, or review work.
- Prefer updating the active note over making duplicate notes.
- Use `since-compaction` by default; ask or use `full` for short sessions; use `n-entries` when user names a window.
- For reviews, include DiffViewer artifact content when available.
- Keep notes human-readable and Dataview-friendly.
- Do not include secrets.

## Dotfiles provisioning for Obsidian CLI

Add verification/remediation tasks to `ansible/roles/tools/tasks/main.yml` and optionally a note in Brewfile/docs.

Plan before implementation:

1. Verify actual command on this machine:
   - `zsh -lc 'command -v obsidian && obsidian help | head'`
   - fallback check: `zsh -lc 'command -v obsidian-cli && obsidian-cli --help | head'`
2. macOS provisioning:
   - Ensure Obsidian app/installer is installed or documented.
   - Verify `/usr/local/bin/obsidian` exists after Obsidian Settings → General → Command line interface.
   - If missing, print remediation rather than pretending Homebrew/npm can install the official CLI.
3. Linux provisioning:
   - Ensure `~/.local/bin` is on PATH.
   - Verify `~/.local/bin/obsidian`; if missing, print official manual copy hint from the Obsidian install directory.
4. Smoke command:
   - `obsidian version` or `obsidian help`.

---

# Workstream B — Git worktree + branch TUI viewer

## Goal

A pi TUI overlay for viewing and cleaning up git worktrees/branches. This is not full neogit; it is a focused worktree/branch hygiene cockpit.

## Files

- `~/.pi/agent/extensions/git-helpers.ts`
- `~/.pi/agent/extensions/pi-gitview.ts`

## Command

Register:

- `/worktrees`
- aliases: `/git`, `/wt`

Default scope: cwd repo only.

Multi-repo support:

- key toggle inside TUI
- optional command arg/config: `/worktrees --all`
- configured repos from `gitview.repos`

## TUI panes

### Pane 1 — Worktrees

Data from `git worktree list --porcelain` plus per-worktree git probes:

- path
- branch
- HEAD short SHA
- last commit relative age
- clean/dirty
- locked/prunable if available
- ahead/behind vs main/default branch
- stale marker when last commit age > 14 days

### Pane 2 — Branches

Data from `git for-each-ref refs/heads`:

- branch name
- last commit date/relative age
- author
- upstream ahead/behind
- merged into main?
- checked out in worktree?

### Pane 3 — History

`git log -20 --oneline --graph --decorate` for selected worktree/branch.

## Actions

Viewer + cleanup only:

- open/reveal selected worktree path
- copy path/branch to clipboard if easy
- ask pi/agents to operate in selected worktree via an explicit, confirmed handoff action that sends a follow-up prompt and writes a timestamped handoff marker
- delete selected worktree with confirm (`git worktree remove`)
- prune worktrees with confirm (`git worktree prune`)
- diff selected branch/worktree vs main
- refresh

Agent-mediated worktree operation rules:

- Before an agent operates inside or cleans up a worktree, it must run preflight checks: `git status --porcelain`, untracked files, ahead/behind, branch/ref, recent commits, and whether the worktree is the current session cwd.
- Worktree handoff writes a timestamped marker such as `.agents/worktree-sessions/<branch-or-worktree>.json` or `.agents/session-paused/<timestamp>.json` containing source session, target worktree, branch, head, dirty summary, and intended action.
- For any destructive cleanup, **always create a backup first** (patch file, stash, safety branch/tag, or exported snapshot depending on state), then require human confirmation.
- The TUI selection itself must not silently switch pi cwd/session.

Explicitly do **not**:

- raw/manual switch pi cwd/session from row selection
- stage files
- commit
- push

---

# Workstream C — Localhost web control plane following Commandr + DiffViewer

## Goal

A local web surface that follows existing Commandr and DiffViewer contracts instead of inventing a new state model.

This should be a browser cockpit for:

- Commandr tasks (`.agents/inbox`, `claimed`, `done`)
- append-only bus events (`.agents/events.jsonl`)
- council verdicts
- approvals state
- annotations
- DiffViewer turns/artifacts/stream
- active pi session note links
- Obsidian notes pane: recent/session-linked notes, current note history, embedded/latest CLI diff output, and buttons to open File Recovery UI via `obsidian history:open`
- worktree/branch state from Workstream B helpers

## Design principles

1. Files/bus artifacts are source of truth.
2. Web server is projection + safe command surface only.
3. Writes shell to canonical Commandr tools (`claim`, `complete`, `progress`, `annotate-write`, approval helper), not ad-hoc file mutation.
4. Stream updates using DiffViewer-style broadcaster/SSE/WebSocket.
5. Localhost-first. Bind `127.0.0.1` only by default.
6. No hosted service.

## Proposed extension/server

New file after A/B are stable:

- `~/.pi/agent/extensions/pi-control-plane.ts`

Command:

- `/control-plane`
- `/cockpit`

Behavior:

1. Start a local HTTP server if not already running.
2. Bind default `127.0.0.1:3340` (configurable).
3. Serve static cockpit UI.
4. Open browser.
5. Watch/project:
   - current repo `.agents/` bus
   - optional configured repos via Commandr index
   - `.diffviewer/turns` / artifacts
   - current pi session/note metadata

## API sketch

Read-only endpoints:

```text
GET /api/health
GET /api/repos
GET /api/commandr/tasks?repo=...
GET /api/commandr/events?repo=...
GET /api/commandr/council?repo=...
GET /api/diffviewer/sessions?repo=...
GET /api/diffviewer/artifacts?repo=...
GET /api/git/worktrees?repo=...
GET /api/git/branches?repo=...
GET /api/obsidian/notes?repo=...
GET /api/obsidian/history?path=...
GET /api/obsidian/diff?path=...&from=1&to=0
GET /stream
```

Safe action endpoints:

```text
POST /api/commandr/progress
POST /api/commandr/annotate
POST /api/commandr/approve
POST /api/commandr/reject
POST /api/git/worktree-handoff
POST /api/git/worktree-remove
POST /api/git/worktree-prune
POST /api/obsidian/open-note
POST /api/obsidian/open-history
```

All write endpoints:

- require localhost origin checks
- require confirmation token for destructive actions
- call canonical tools/helpers
- append/display event results

## Relationship to DiffViewer

Two options:

### Option C1 — separate cockpit server

Pros: minimal coupling; can be implemented as a pi extension; uses DiffViewer APIs if running.

Cons: two local servers/pages.

### Option C2 — extend DiffViewer server/browser

Pros: one web UI; already has broadcaster and endpoints.

Cons: crosses repo/package boundary; harder to keep pi extension standalone.

**Proposed default:** C1 first. Follow DiffViewer's broadcaster pattern and optionally link/open DiffViewer pages/artifacts. Later merge if the shape proves stable.

## Commandr protocol compliance

The control plane must respect:

- `.agents/` in main checkout, resolved from worktrees.
- `events.jsonl` append-only.
- `~/.agents/index.json` derived-only cache.
- no unknown event writes.
- no harness-private state under `.agents/`.
- annotations written via canonical writer / same schema.

---

# Config additions

```json
{
  "obsidianBridge": true,
  "obsidianCli": "obsidian",
  "obsidianVault": "/Users/vietquocbui/repos/Obsidian",
  "obsidianProjectVaults": {
    "llm-wiki": "/Users/vietquocbui/repos/llm-wiki/wiki"
  },
  "obsidianFolders": {
    "spec": "Sessions/Specs",
    "design": "Sessions/Specs",
    "arch": "Sessions/Specs",
    "plan": "Sessions/Plans",
    "pr": "Sessions/Reviews",
    "review": "Sessions/Reviews",
    "note": "Sessions/Inbox"
  },
  "obsidianContextCapture": true,
  "obsidianDefaultContextMode": "since-compaction",
  "obsidianHistoryLimit": 10,
  "redactPatterns": [],
  "gitview": {
    "staleDays": 14,
    "historyDepth": 20,
    "multiRepo": false,
    "repos": ["~/dotfiles", "~/repos/Commandr"]
  },
  "controlPlane": {
    "enabled": true,
    "host": "127.0.0.1",
    "port": 3340,
    "openBrowser": true,
    "multiRepo": false
  }
}
```

---

# Build order

1. Verify official `obsidian` CLI command shape and add Ansible/Brewfile verification/remediation.
2. `git-helpers.ts` shared helpers.
3. Workstream B: `/worktrees` TUI viewer/cleanup.
4. Workstream A: `pi-obsidian.ts` hook/tool/commands + skill.
5. Modify `pi-session.ts` to route `/spec`, `/plan`, `/review` through Obsidian note helper.
6. Workstream C: local cockpit server, read-only first.
7. Add safe action endpoints after read-only cockpit is stable.
8. Diagnostics/smoke:
   - `lsp_diagnostics` on new TS files
   - `pi /reload`
   - `/worktrees`
   - `/obsidian-note --kind plan --context since-compaction`
   - `/control-plane`

## Out of scope

- Full neogit staging/commit/push.
- Hosted dashboard.
- Auto-delete stale worktrees without confirm.
- Obsidian plugin development as a required dependency. We may use Obsidian CLI and official core plugins.
- Cross-machine Commandr coordination.
