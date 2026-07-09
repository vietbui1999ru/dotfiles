<!-- markdownlint-disable MD013 MD024 MD025 -->

# Final Plan: AgentOps Vault + DiffView Review Gate + Pi Workflow

Status: **FINAL pre-implementation plan**  
Date: 2026-07-09

This supersedes the earlier Obsidian/Git TUI/control-plane draft. The final direction is:

```text
AgentOps vault     = human memory, dashboards, durable summaries
DiffView extension = visual diff fidelity + review artifacts
Pi review gate     = sandbox generation, patch batches, approval state, apply enforcement
Commandr           = task/event bus + cross-agent workflow coordination
```

Non-negotiable separation:

> **DiffView owns visual diff fidelity. Pi owns workflow state. AgentOps owns durable memory.**

AgentOps must not become the source of truth for code approval state. It is a projection/history layer.

---

## 1. Goals

Create a dedicated git-tracked Obsidian vault at:

```text
$HOME/repos/AgentOps
```

for tracking Pi, Claude, Codex, opencode, Commandr, DiffView, review-gate, and related agent work.

The new vault replaces the current accidental target:

```text
$HOME/repos/Obsidian
```

for all agent workflow notes.

Primary outcomes:

- Stop Pi/agent workflow scripts from touching the main personal Obsidian vault.
- Isolate AgentOps plugin configuration from the main vault.
- Auto-repair accidentally disabled AgentOps plugins before opening the vault.
- Store efficient run/review/spec history without dumping raw JSONL/logs.
- Integrate with DiffView and Commandr without replacing either.
- Add a review-gate contract for sandboxed AI codegen and per-file patch approval.

---

## 2. Current findings

Inspected code/config:

```text
pi/.pi/agent/extensions/pi-obsidian.ts
pi/.pi/agent/extensions-available/pi-control-plane.ts
shared/agent-workflow.default.json
~/.config/agent-workflow/config.json
```

Findings:

- `pi-obsidian.ts` fallback vault is currently `$HOME/repos/Obsidian`.
- `shared/agent-workflow.default.json` also sets `obsidianVault` to `~/repos/Obsidian`.
- User config does not override `obsidianVault`, so the bad default wins.
- `/cp` lives in `pi/.pi/agent/extensions-available/pi-control-plane.ts` and also falls back to `~/repos/Obsidian`.
- `$HOME/repos/AgentOps` does not exist yet.
- Obsidian note creation should not be used again until defaults are redirected.

---

## 3. Vault contract

Create:

```text
$HOME/repos/AgentOps/
  Inbox/
  Projects/
  Runs/
  Reviews/
  System/
  .obsidian/
```

Folder meanings:

- `Inbox/` — quick captures and unclassified notes.
- `Projects/` — specs, plans, designs, architecture notes, project workflow docs.
- `Runs/` — one main note per agent run/session.
- `Reviews/` — review batches, DiffView links, approval summaries.
- `System/` — templates, dashboards, plugin guard reports, vault docs.

Large/raw artifacts:

- Prefer linking existing source artifacts from `.diffviewer/`, `.review-gate/`, `.agents/`, or Pi session paths.
- Only copy large artifacts into `Reviews/_artifacts/` when needed for portability.
- Do not embed raw JSONL or huge logs in notes unless explicitly requested.

---

## 4. Git tracking policy

AgentOps is git-tracked, but only partially.

Commit:

```text
Inbox/.gitkeep
Projects/.gitkeep
Runs/.gitkeep
Reviews/.gitkeep
System/Templates/*.md
System/Dashboards/*.md
System/plugin-guard.md
.obsidian/app.json
.obsidian/appearance.json
.obsidian/core-plugins.json
.obsidian/community-plugins.json
.obsidian/hotkeys.json
.obsidian/plugins/*/data.json where useful
```

Ignore:

```gitignore
.obsidian/workspace*.json
.obsidian/cache/
.obsidian/plugins/*/main.js
.obsidian/plugins/*/styles.css
.trash/
*.tmp
Reviews/_artifacts/raw/
```

Rationale:

- Plugin enablement/config is reproducible.
- Workspace state and downloaded plugin binaries are local/cache-like.
- Future multi-machine sync can reconstruct plugin binaries from documented IDs.

---

## 5. Portable vault path resolution

Replace all hardcoded `~/repos/Obsidian` defaults.

Resolution order:

1. explicit tool/command arg
2. repo `.agent-workflow.local.json`
3. repo `.agent-workflow.json`
4. user `~/.config/agent-workflow/config.json`
5. environment variables:

   ```sh
   AGENTOPS_VAULT="$HOME/repos/AgentOps"
   PI_OBSIDIAN_VAULT="$HOME/repos/AgentOps"
   ```

6. final fallback:

   ```ts
   path.join(os.homedir(), "repos", "AgentOps")
   ```

Path expansion must support:

```text
~
$HOME
${HOME}
```

Safety rule:

> Agent workflow commands must never silently fall back to `$HOME/repos/Obsidian`.

If a resolved vault path is `$HOME/repos/Obsidian`, fail loudly unless explicitly forced by an opt-in flag/config.

---

## 6. Obsidian plugin soft guard

Desired protection level: soft guard + auto repair + fail loud.

Before `/cp`, `/obsidian-note`, or any AgentOps open action:

1. ensure vault skeleton exists
2. ensure `.obsidian/core-plugins.json` exists
3. ensure `.obsidian/community-plugins.json` exists
4. restore missing required core/community plugin IDs
5. fail loudly if required community plugin folders are missing
6. write repair report:

   ```text
   System/plugin-guard-last-run.md
   ```

This protects accidental toggles. It does not fight intentional manual plugin changes after the user edits the required plugin list.

### Required core plugin IDs

Seed list:

```text
file-explorer
global-search
switcher
graph
backlink
canvas
outgoing-link
tag-pane
page-preview
daily-notes
templates
command-palette
file-recovery
properties
bookmarks
```

### Required community plugin IDs

Seed list:

```text
dataview
obsidian-tasks-plugin
templater-obsidian
periodic-notes
calendar
obsidian-git
cmdr
buttons
obsidian-meta-bind-plugin
obsidian-advanced-uri
quickadd
obsidian-kanban
obsidian-excalidraw-plugin
omnisearch
obsidian-linter
obsidian-style-settings
```

The plugin list is intentionally broad for first boot. User can later prune/update it.

---

## 7. Obsidian open behavior

Best effort separate instance is acceptable.

Open strategy:

1. Prefer official Obsidian CLI when available.
2. Use AgentOps vault path/name explicitly.
3. If AgentOps is already open, focus/open note in current app instance.
4. If separate instance/profile is possible on the platform, attempt it.
5. Fallback to normal Obsidian open URI/app launch.
6. Never open the old main vault for agent workflow commands unless explicitly forced.

Shortest user commands:

Inside Pi:

```text
/cp
```

Shell:

```sh
ao
```

`ao` default means `ao open`.

Planned helper commands:

```sh
ao open
ao repair
ao status
ao note
```

---

## 8. AgentOps note model

### 8.1 Run note

One main note per agent run/session:

```text
Runs/<project>/<YYYYMMDD>-<harness>-<session_id>.md
```

Frontmatter:

```yaml
---
type: run
project:
harness: pi | claude | codex | opencode
agent:
model:
status: active | paused | done | failed
session_id:
session_file:
repo:
worktree:
branch:
commit:
commandr_task:
review_batch:
created:
updated:
tags: [agentops, run]
---
```

Body sections:

```md
# <Run title>

## TLDR

## Current State

## Decisions

## Files / Artifacts

## Compressed History

## Links
```

Old session content should compress into caveman TLDR:

```md
## Compressed History

- DID: planned AgentOps vault.
- FOUND: old Obsidian bridge targets ~/repos/Obsidian.
- DECIDED: DiffView renders diffs; Pi tracks workflow state.
- NEXT: redirect vault defaults to $HOME/repos/AgentOps.
```

### 8.2 Project/spec/plan note

Path:

```text
Projects/<project>/<phase>-<slug>.md
```

Types:

```text
spec
plan
design
arch
pr
decision
```

### 8.3 Review note

Path:

```text
Reviews/<project>/<YYYYMMDD>-review-<batch_id>.md
```

Frontmatter:

```yaml
---
type: review
project:
batch_id:
status: pending | reviewing | approved | partially-approved | rejected | stale | conflicted | applied
repo:
base_commit:
sandbox_path:
review_ledger:
diffview_artifact:
created:
updated:
tags: [agentops, review]
---
```

Review notes include:

- batch ID
- sandbox/worktree path
- base commit
- files reviewed
- approved/rejected/deferred counts
- stale/conflict warnings
- DiffView artifact links
- final apply status

Important:

> Review notes are projections of the review-gate ledger, not canonical approval state.

---

## 9. Review-gate locked decisions

From grill/review session:

- AI/subagents must generate in sandbox/worktree, not main.
- Subagent output becomes patch batches for review.
- Review budget is approximately 50 changed LOC, not a hard generation block.
- LOC means additions + deletions + modifications.
- Formatting diffs count.
- Tests/docs are reviewable but excluded from LOC budget.
- Generated/vendor/lock/snapshot files are excluded or collapsed.
- Approval is per file; chunks are review aids.
- UI is keyboard-only full overlay.
- DiffView is the diff rendering backend.
- Pi overlay owns orchestration, progress, approval state, and apply enforcement.
- Rejection means mechanical exclusion/revert from apply set plus optional feedback prompt.
- Apply occurs after generation batch, not live during generation.

---

## 10. Review-gate canonical ledger

Canonical review state must live outside AgentOps Markdown.

Default ledger location:

```text
.review-gate/batches/<batch_id>.json
```

Alternative if DiffView formally owns these artifacts:

```text
.diffviewer/review-batches/<batch_id>.json
```

Do not hide private review-gate state under `.agents/` unless Commandr formally adopts that schema.

### Ledger schema sketch

```json
{
  "batchId": "batch-20260709-abc123",
  "schemaVersion": 1,
  "repo": "/path/to/repo",
  "baseCommit": "...",
  "sandboxPath": "/path/to/worktree-or-sandbox",
  "generatedBy": {
    "harness": "pi",
    "agent": "openai-codex/gpt-5.5",
    "sessionFile": "..."
  },
  "status": "pending",
  "created": "2026-07-09T00:00:00Z",
  "updated": "2026-07-09T00:00:00Z",
  "files": [
    {
      "path": "src/example.ts",
      "action": "create|modify|delete|rename",
      "baseFileHash": "...",
      "mainHashAtReviewStart": "...",
      "sandboxHash": "...",
      "patchHash": "...",
      "changedLoc": 47,
      "locBudgetExempt": false,
      "excludedReason": null,
      "chunks": [
        {
          "id": "src/example.ts#1",
          "index": 1,
          "changedLoc": 47,
          "diffHunkRange": "@@ -10,7 +10,35 @@",
          "seen": false
        }
      ],
      "status": "pending|reviewing|approved|rejected|deferred|stale|conflicted|applied"
    }
  ]
}
```

Required per-file stale fields:

```text
baseCommit
baseFileHash
mainHashAtReviewStart
sandboxHash
patchHash
```

Before applying a file:

```text
if currentMainHash !== mainHashAtReviewStart:
  status = stale/conflicted
  block apply
  offer: rebase patch / view conflict / defer / feedback
```

---

## 11. Review-gate enforcement layer

Sandbox/worktree-only mutation must be enforced, not merely documented.

Pi review gate responsibilities:

- Intercept `edit`, `write`, and mutating `bash` during generation.
- Block main worktree mutation during generation mode.
- Route subagents into sandbox/worktree only.
- Convert subagent output into patch batch ledger.
- Allow only approved file patches to apply to main worktree.
- Revalidate hashes before apply.
- Record apply results back to ledger and AgentOps projection note.

Mutating bash detection should start conservative and configurable.

Examples of commands requiring sandbox/worktree context:

```text
rm
mv
cp > repo path
python/perl/node scripts that rewrite files
formatters with --write
package managers that modify lockfiles
```

Tests can run in sandbox and/or main depending on phase, but generated code mutation remains sandboxed.

---

## 12. DiffView integration contract

DiffView is the visual diff backend. Pi/control-plane must not implement a second canonical diff renderer.

Minimum contract:

```text
createReviewArtifact(batch)
openDiffView(batchId, file?, chunk?)
getArtifactUrl(batchId)
```

Preferred data flow:

```text
.review-gate/batches/<batch_id>.json
  -> DiffView review artifact
  -> Pi keyboard overlay opens/navigates DiffView artifact
  -> AgentOps review note links/embeds artifact summary
```

Important rule:

> Do not watch `.diffviewer/turns` as the primary source of truth.

Reason: DiffViewer sidecar turn files may be transient; existing DiffViewer behavior can watch, broadcast, then unlink sidecars.

Preferred sources:

```text
DiffViewer /stream
DiffViewer APIs
stable DiffViewer artifacts
review-gate ledger
```

`.diffviewer/turns` may be used only as best-effort debug fallback.

---

## 13. Review TUI / overlay contract

Keyboard-only full overlay, optimized for review after generation batch.

Example:

```text
┌ AI Codegen Review ─────────────────────────────────────────────┐
│ Batch: batch-20260709-abc123                                   │
│ File 2/6: src/auth/session.ts   modify   +132 -41 = 173 LOC    │
│ Chunk 3/4                      ~46 LOC   Status: reviewing     │
│ Base: clean ✓   Main: unchanged ✓   Sandbox: ready ✓           │
├────────────────────────────────────────────────────────────────┤
│ DiffView artifact / rendered diff region                       │
├────────────────────────────────────────────────────────────────┤
│ Progress: [■■■□] chunks seen   File approval: pending          │
│ Files: 1 approved · 1 reviewing · 4 pending · 0 conflicted     │
├────────────────────────────────────────────────────────────────┤
│ j/k scroll · n/p chunk · ]/[ file · a approve · r reject       │
│ d defer · f feedback · x apply approved · ? help · q close     │
└────────────────────────────────────────────────────────────────┘
```

Keyboard map:

```text
Navigation:
j/k       scroll diff
n/p       next/previous chunk
]/[       next/previous file
g/G       first/last file
?         help

Review:
space     mark chunk reviewed
a         approve current file
r         reject current file
d         defer current file
f         send feedback to agent
w         acknowledge oversized hunk warning

Batch:
x         apply all approved files
R         regenerate rejected/deferred files
q         close overlay
```

Approval behavior:

- `a` approves the file, not an individual chunk.
- If not all chunks were viewed, show warning but allow override.
- Oversized hunks are visually split and require explicit warning acknowledgement.
- `x` always shows final confirmation and performs hash revalidation.

Reject behavior:

```text
reject file:
  - mechanically exclude/revert patch from apply set
  - optionally open feedback prompt for agent regeneration
```

---

## 14. Commandr integration

Commandr remains the task/event workflow bus.

Respect Commandr constraints:

- `.agents/` lives in the main checkout, not each worktree.
- `events.jsonl` is append-only.
- `~/.agents/index.json` is derived cache only.
- Do not invent private review-gate schemas under `.agents/` unless Commandr adopts them.

AgentOps notes may include:

```yaml
commandr_task:
commandr_status:
commandr_bus:
```

Control-plane actions that update Commandr should shell to canonical Commandr tools/helpers rather than ad-hoc mutating `.agents/` files.

---

## 15. Control plane scope

`/cp` should be a cockpit/orchestration surface, not the owner of review workflow.

Allowed responsibilities:

- start/open local cockpit
- display Commandr status
- display recent AgentOps notes
- display review batch summaries
- link/open DiffView artifacts
- call review-gate namespaced endpoints

Avoid:

- duplicate diff renderer
- canonical approval state in web UI only
- generic `/approve` / `/reject` semantics that collide with DiffView or Commandr

Use namespaced endpoints for patch review:

```text
/api/review-gate/approve-file
/api/review-gate/reject-file
/api/review-gate/defer-file
/api/review-gate/send-feedback
/api/review-gate/apply-approved
```

DiffView/mobile endpoints like `/approve`, `/reject`, `/undo` must not be confused with review-gate file patch approval.

---

## 16. Config changes

Update defaults:

```json
{
  "obsidianBridge": true,
  "obsidianCli": "obsidian",
  "obsidianVault": "$HOME/repos/AgentOps",
  "obsidianFolders": {
    "spec": "Projects",
    "design": "Projects",
    "arch": "Projects",
    "plan": "Projects",
    "pr": "Reviews",
    "review": "Reviews",
    "note": "Inbox"
  },
  "obsidianContextCapture": true,
  "obsidianDefaultContextMode": "since-compaction",
  "obsidianHistoryLimit": 10,
  "agentOpsVault": "$HOME/repos/AgentOps",
  "reviewGate": {
    "enabled": true,
    "ledgerDir": ".review-gate/batches",
    "defaultChunkLoc": 50,
    "approvalUnit": "file",
    "generationMode": "sandbox"
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

## 17. Implementation files

Likely modified:

```text
shared/agent-workflow.default.json
scripts/agent-workflow
pi/.pi/agent/extensions/pi-obsidian.ts
pi/.pi/agent/extensions-available/pi-control-plane.ts
pi/.pi/agent/extensions/pi-session.ts
```

Likely new:

```text
scripts/ao
shared/agentops-vault/.gitignore
shared/agentops-vault/.obsidian/core-plugins.json
shared/agentops-vault/.obsidian/community-plugins.json
shared/agentops-vault/System/Templates/*.md
shared/agentops-vault/System/Dashboards/*.md
pi/.pi/agent/extensions/pi-review-gate.ts
```

Review-gate ledger created at runtime per repo:

```text
.review-gate/batches/<batch_id>.json
```

---

## 18. Build order

### Phase 0 — No more wrong-vault writes

- Do not call `obsidian_note` until vault defaults are redirected.
- Add guard that refuses `$HOME/repos/Obsidian` for agent workflow unless explicitly forced.

### Phase 1 — AgentOps vault bootstrap

- Create `$HOME/repos/AgentOps` skeleton.
- Add partial `.gitignore`.
- Initialize git if absent.
- Seed `.obsidian` plugin config.
- Seed templates/dashboards.

### Phase 2 — Path/config fix

- Update `shared/agent-workflow.default.json` to `$HOME/repos/AgentOps`.
- Update `pi-obsidian.ts` default vault and env/path expansion.
- Update `/cp` control-plane vault resolver.
- Add old-vault refusal guard.

### Phase 3 — Plugin soft guard

- Implement AgentOps repair function.
- Auto-repair core/community plugin JSON.
- Fail loud on missing required community plugin folders.
- Write `System/plugin-guard-last-run.md`.

### Phase 4 — AgentOps note templates

- Add run/review/spec/plan templates.
- Add caveman TLDR compression section.
- Add richer frontmatter.
- Add dashboards.

### Phase 5 — Fake review batch first

Before real DiffView integration:

- Create fake `.review-gate/batches/<batch_id>.json`.
- Create AgentOps review note projection.
- Render/open via DiffView if available, otherwise link placeholder.
- Test applying one approved fake file with hash revalidation.

### Phase 6 — DiffView contract integration

- Implement/consume:

  ```text
  createReviewArtifact(batch)
  openDiffView(batchId, file?, chunk?)
  getArtifactUrl(batchId)
  ```

- Do not use `.diffviewer/turns` as primary source.

### Phase 7 — Pi review-gate enforcement

- Intercept `edit`, `write`, mutating `bash` during generation mode.
- Force subagent generation into sandbox/worktree.
- Produce review batch ledger.
- Add keyboard overlay.
- Apply approved file patches only after hash revalidation.

### Phase 8 — `/cp` cockpit polish

- Show AgentOps notes.
- Show Commandr state.
- Show review batch state.
- Link/open DiffView artifacts.
- Expose only namespaced review-gate endpoints.

### Phase 9 — Smoke tests

Run:

```text
/obsidian-note plan AgentOps vault smoke test
/cp
```

Verify:

- note lands under `$HOME/repos/AgentOps`
- no writes to `$HOME/repos/Obsidian`
- plugin guard report exists
- fake review batch note exists
- review-gate ledger exists
- approved fake file apply checks hashes

---

## 19. Acceptance criteria

Must pass before implementation is considered done:

- `agent-workflow config` shows AgentOps vault by default.
- `ao status` reports vault exists and plugin guard state.
- `ao open` opens/focuses AgentOps, not main Obsidian vault.
- `/obsidian-note` writes to AgentOps.
- `/spec`, `/plan`, `/review` write to AgentOps.
- `/cp` reads AgentOps folders and does not fall back to main vault.
- Missing/toggled plugins are repaired or reported loudly.
- Main vault `$HOME/repos/Obsidian` is untouched in smoke tests.
- Review-gate ledger exists outside Markdown.
- AgentOps review note links to ledger and DiffView artifact.
- DiffView is not duplicated as a separate renderer.
- `.diffviewer/turns` is not treated as source of truth.
- Approved file apply revalidates hashes.

---

## 20. Out of scope

- Full Obsidian plugin development.
- Hosted dashboard.
- Replacing DiffView.
- Replacing Commandr.
- Full neogit/stage/commit/push UI.
- Auto-deleting stale worktrees without explicit confirmation.
- Making AgentOps Markdown the canonical runtime state.
- Fighting intentional manual plugin changes after the required plugin list is edited.
