<!-- markdownlint-disable MD013 MD024 MD025 MD033 -->

# AgentOps Vault — Daily Workflow

How to use AgentOps, the `ao` helper, and the review-gate day-to-day.

---

## 1. Session capture (Pi)

When starting a Pi session that involves specs, plans, design, or reviews,
Pi will prompt you automatically (if `obsidianContextCapture` is on):

```
Start Obsidian session note?
Detected plan work. Create/update an Obsidian note from current session context?
```

Answer `y` to capture session context into `~/repos/AgentOps/Projects/`.

**Manual alternative:**

```text
/obsidian-note plan "Implement auth middleware"
/obsidian-note review "PR #42 review batch"
/obsidian-note spec "AgentOps vault spec"
```

### Frontmatter auto-filled

Each note gets:

```yaml
---
kind: spec
title: AgentOps vault spec
created: 2026-07-09T17:00:00Z
updated: 2026-07-09T17:30:00Z
pi_session: /path/to/session.jsonl
git_branch: feat/agentops
git_head: abc1234
tags: [pi-session, spec]
---
```

### Session context block

Every note has a `<!-- pi:session-context -->` block with:

- User asks and decisions (last 12)
- Assistant summaries (last 8)
- Tool calls (last 12)
- Errors (last 10)
- Compaction summaries (last 5)

### History block

A running changelog at the bottom:

```text
<!-- pi:history:start -->
## History
- 2026-07-09T17:00:00Z — spec update — mode=since-compaction — branch=feat/agentops
- 2026-07-08T14:30:00Z — created — mode=full — branch=main
<!-- pi:history:end -->
```

### Recovery diff

Every update appends an Obsidian File Recovery diff section
(`<!-- pi:obsidian-recovery:start -->`) so you can see what changed
between updates.

---

## 2. Quick captures from shell

```sh
ao note "discussed moving to sqlite for session store"
```

Creates `Inbox/20260709-discussed-moving-to-sqlite-for-session-store.md`
with timestamp and `type: inbox` frontmatter.

Process inbox notes later by moving them into `Projects/`, `Runs/`, or `Reviews/`.

---

## 3. Daily review workflow

### Code generation with sandbox

```text
# Inside Pi session:
/review-sandbox feat-my-change     # creates git worktree
# Agent generates code there       # (edit/write blocked on main worktree)
/review-batch ../.review-gate-sandbox-feat-my-change "pi/codex"
```

This creates a review batch at `.review-gate/batches/review-2026-07-09-abc123/batch.json`.

### Review overlay

```text
/review
```

Opens the keyboard overlay:

```
┌ AI Codegen Review ─────────────────────────────────────────────┐
│ File 1/6: src/auth.ts  ✏️  47 LOC  Status: pending             │
│ Chunk 1/2  ~25 LOC                                              │
├────────────────────────────────────────────────────────────────┤
│ diff content here                                               │
├────────────────────────────────────────────────────────────────┤
│ ✓ 0 approved  ✗ 0 rejected  ○ 6 pending                        │
│ j/k scroll · n/p chunk · ]/[ file · a approve · r reject       │
│ d defer · f feedback · x apply approved · ? help · q close     │
└────────────────────────────────────────────────────────────────┘
```

Keybindings:

| Key | Action |
|-----|--------|
| `j` / `k` | Scroll diff up/down |
| `n` / `p` | Next/previous chunk |
| `]` / `[` | Next/previous file |
| `g` / `G` | First/last file |
| `space` | Mark chunk reviewed |
| `a` | Approve current file |
| `r` | Reject current file |
| `d` | Defer current file |
| `f` | Send feedback to agent |
| `w` | Acknowledge oversized hunk |
| `x` | Apply all approved files |
| `?` | Toggle help |
| `q` | Close overlay |

### Batch management

```text
/review-list                    # show all batches with status
/review-gate                    # toggle gate on/off
```

Review notes are automatically created in `~/repos/AgentOps/Reviews/`.

---

## 4. Dashboard views (Obsidian)

Open the AgentOps vault and use the Dataview dashboards:

| Dashboard | What it shows |
|-----------|---------------|
| `System/Dashboards/AgentOps.md` | All notes across Runs/Projects/Reviews, sorted by mtime |
| `System/Dashboards/Runs.md` | Active runs only |
| `System/Dashboards/Reviews.md` | Pending reviews |

---

## 5. Vault maintenance

### Plugin guard

Run after installing/removing Obsidian plugins:

```sh
ao repair
```

This checks core and community plugin configs, restores any that were
accidentally removed, and writes a report to
`System/plugin-guard-last-run.md`.

### Git snapshot

The vault auto-commits tracked changes when you open it with Obsidian Git
plugin (if installed). Manual:

```sh
cd ~/repos/AgentOps
git status
git add -A
git commit -m "chore: update notes"
```

### Repair vault

```sh
./scripts/setup-agentops.sh --repair    # plugin guard only
./scripts/setup-agentops.sh             # full idempotent re-bootstrap
```

---

## 6. Integration with other tools

### Pi control plane

```text
/cp
```

Opens a local web dashboard (`http://127.0.0.1:3340`) showing:

- Commandr task bus (inbox/claimed/done)
- AgentOps notes (recent)
- Review batch state (when available)

### DiffView

When DiffView extension is installed, review batches automatically create
an artifact summary in `.diffviewer/review-batches/<id>/artifact.json`.
DiffView picks this up for visual diff rendering.

### Commandr

Review approval/rejection events can be pushed to the Commandr event bus
for cross-agent coordination:

```text
/agents/done/task-id-review-batch-abc123.md
```

---

## 7. Config reference

```jsonc
// ~/.config/agent-workflow/config.json (or ~/dotfiles/shared/agent-workflow.default.json)
{
  "obsidianBridge": true,
  "obsidianCli": "obsidian",
  "obsidianVault": "~/repos/AgentOps",          // ← must be AgentOps, not Obsidian
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
  "reviewGate": {
    "enabled": true,
    "ledgerDir": ".review-gate/batches",
    "defaultChunkLoc": 50,
    "approvalUnit": "file",
    "generationMode": "sandbox"
  }
}
```

---

## 8. Quick reference

### Shell

```sh
ao                    # open vault
ao status             # show vault health
ao repair             # run plugin guard
ao note "text"        # quick capture
```

### Pi commands

| Command | What it does |
|---------|-------------|
| `/obsidian-note spec|plan|design|arch|pr|review|note <title>` | Create/update session note |
| `/obsidian-update <path>` | Refresh existing note |
| `/cp` | Open control-plane dashboard |
| `/review` | Open review overlay |
| `/review-list` | List batches |
| `/review-batch <sandbox> [agent]` | Create batch from diff |
| `/review-sandbox <branch>` | Create git worktree |
| `/review-gate` | Toggle mutation blocking |

### Files

| Path | Purpose |
|------|---------|
| `~/repos/AgentOps/` | Obsidian vault root |
| `~/dotfiles/scripts/ao` | Shell helper |
| `~/dotfiles/scripts/setup-agentops.sh` | Bootstrap script |
| `~/dotfiles/docs/SETUP-obsidian-gittui.md` | Setup guide (this) |
| `~/dotfiles/docs/PLAN-obsidian-gittui.md` | Full plan |
| `~/dotfiles/docs/workflows/agentops-workflow.md` | Workflow guide |
| `~/dotfiles/pi/.pi/agent/extensions/pi-obsidian.ts` | Pi→Obsidian bridge |
| `~/dotfiles/pi/.pi/agent/extensions/pi-review-gate.ts` | Review gate extension |
| `.review-gate/batches/<id>/batch.json` | Per-repo review ledger |
