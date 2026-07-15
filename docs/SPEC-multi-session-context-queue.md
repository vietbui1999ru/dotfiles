# SPEC: Multi-Session Context Queue

**Status:** Proposed — implementation-ready

**Date:** 2026-07-15

**Owners:** Agent workflow / Pi session inbox / AgentOps

**Related plan:** [`docs/PLAN-obsidian-gittui.md`](./PLAN-obsidian-gittui.md)

**Related workflow:** [`docs/workflows/agentops-workflow.md`](./workflows/agentops-workflow.md)

**Related setup:** [`docs/SETUP-obsidian-gittui.md`](./SETUP-obsidian-gittui.md)

**Primary implementation files:**

- `scripts/agent-session`
- `pi/.pi/agent/extensions/pi-session.ts`
- `shared/agent-workflow.default.json`
- `.gitignore` and shared session-inbox documentation
- optional AgentOps projection/template files

---

## 1. Executive Summary

When two Pi sessions work in the same repository at the same time, they must
remain independently resumable.

Example:

```text
Pi session A: implement feature A
Pi session B: investigate/fix feature B
```

After the user invokes `clear-context` in both sessions, the next Pi session
must not silently choose only the newest checkpoint. It must show a readable
queue of resumable work items and allow the user or AI to choose which one to
inspect and resume.

The system must preserve:

1. each logical feature/work item;
2. each Pi session and its parent/child relationship;
3. the latest human-readable checkpoint;
4. the next actions/todo list;
5. repository, branch, worktree, and commit context;
6. stale/orphan/conflict information;
7. enough metadata for an AI to select safely without guessing.

The system must not silently delete, overwrite, or auto-resume one context at
the expense of another.

---

## 2. Problem Statement

The repository already contains a universal session inbox:

```text
<repo>/.agents/sessions/
<repo>/.agents/sessions/index.json
```

It also has Pi commands such as:

```text
/save-session
/clear-context
/sessions
/resume-session
```

However, the current behavior is effectively single-context:

1. `agent-session save` creates multiple files, but does not assign a stable
   logical work-item identity.
2. `agent-session active` returns only the latest record whose status is
   `active`.
3. Pi startup calls `active` and stores only that one result.
4. There is no reliable interactive selection flow before state injection.
5. Old records remain `active` indefinitely unless manually marked idle.
6. Existing records may point to deleted branches, missing worktrees, or old
   repository state.
7. Concurrent saves can race while reading and rewriting `index.json`.
8. The legacy pointer files imply one current state per harness even though
   the universal inbox contains many records.
9. Session filenames contain a slug, but the slug is not a durable identity.
10. The current Obsidian note bridge can still resolve notes under
    `Sessions/Specs` instead of the intended AgentOps `Projects/` folder.

This creates three risks:

- **Context loss:** the user cannot easily find the older feature context.
- **Wrong-context resumption:** Pi injects the newest but unrelated feature.
- **Context pollution:** stale and orphaned records make the queue harder for
  both humans and AI agents to understand.

---

## 3. Goals

### 3.1 Primary goals

- Preserve multiple independent contexts in one repository.
- Support multiple Pi sessions in the same directory and on the same branch.
- Give every logical work item a stable identity.
- Give every saved checkpoint a stable identity.
- Provide an interactive, human-readable session picker.
- Provide a machine-readable queue for AI agents and scripts.
- Make `/clear-context` save without overwriting another work item.
- Make `/clear-context` save without creating uncontrolled duplicate records.
- Keep the latest checkpoint easy to resume.
- Show todos/next actions prominently.
- Detect stale, orphaned, missing, and conflicting contexts.
- Preserve old contexts until the user explicitly archives or deletes them.
- Make concurrent saves safe through atomic writes and index reconciliation.
- Maintain compatibility with existing legacy pointer files.
- Keep sensitive/raw session JSONL out of normal Markdown notes.

### 3.2 Secondary goals

- Project a concise summary into AgentOps/Obsidian without making Markdown the
  runtime source of truth.
- Support cross-harness records from Pi, Claude Code, Codex, and OpenCode.
- Support future multi-machine synchronization.
- Make cleanup explainable and reversible.
- Make behavior deterministic enough for tests and automation.

---

## 4. Non-Goals

This feature does not initially:

- merge two different feature contexts into one context;
- automatically infer that two similarly named features are the same;
- delete stale contexts without explicit user confirmation;
- make AgentOps Markdown the canonical runtime state;
- capture or embed complete raw JSONL transcripts by default;
- solve arbitrary cross-branch code conflicts;
- automatically switch the current Git branch or worktree;
- automatically apply code changes from a resumed context;
- replace Commandr task state;
- replace the review-gate ledger;
- synchronize private session content to a remote service.

---

## 5. Terminology

### 5.1 Repository

The Git main worktree root containing `.agents/sessions/`.

### 5.2 Work item

A logical unit of work that should remain independently resumable.

Examples:

```text
agentops-multi-session-queue
review-gate-diffview-contract
fix-obsidian-cli-open
```

A work item survives Pi context resets and may contain multiple Pi sessions.

### 5.3 Session

One harness execution or conversational thread associated with a work item.
A Pi `sessionManager` session file is one example.

### 5.4 Checkpoint

A human-readable saved snapshot produced by `/save-session` or
`/clear-context`.

### 5.5 Queue

The derived set of work items that are resumable, stale, conflicted, or need
attention. The queue is not a separate competing source of truth; it is derived
from session records and metadata.

### 5.6 Active

A session currently believed to be running, based on a recent heartbeat or
known process/session ownership. `active` must not mean merely “not completed.”

### 5.7 Paused

A valid saved context that is not currently running and may be resumed.

### 5.8 Stale

A valid context whose freshness or repository assumptions require user review.
Stale is a warning state, not deletion.

### 5.9 Orphaned

A record whose referenced file, repository, worktree, branch, parent, or index
relationship cannot be resolved. Orphaned records are retained for recovery.

### 5.10 Archived

A deliberately hidden record retained on disk but omitted from the default
resume queue.

---

## 6. Recommended Product Decisions

These decisions are the default contract for implementation.

### 6.1 Canonical storage

Use the existing per-repository inbox as the canonical runtime store:

```text
<repo>/.agents/sessions/
```

Do not introduce `.Codex/sessions/` as a second canonical store.

Reasons:

- the universal inbox already supports all harnesses;
- existing tools and legacy pointers already reference it;
- one repository has one shared queue;
- duplicate stores would create synchronization and orphan problems.

The AgentOps vault receives a summarized projection only.

### 6.2 Stable identity model

Use three identifiers:

```text
work_item_id  = stable logical feature/task identity
session_id    = one harness conversation/thread identity
checkpoint_id = one saved checkpoint identity
```

Recommended format:

```text
work_item_id: wi-<slug>-<short-random-id>
session_id:    sess-<harness>-<short-random-id>
checkpoint_id: cp-<UTC timestamp>-<short-random-id>
```

The random suffix prevents collisions when two sessions start in the same
second. IDs must never be derived only from timestamps or filenames.

### 6.3 Feature naming

Support both explicit and inferred naming:

1. explicit user input wins;
2. existing work-item identity wins when continuing a work item;
3. prompt the user when multiple active/resumable contexts are plausible;
4. infer a provisional slug only as a last resort;
5. mark inferred identity as `identity_confidence: inferred`.

Examples:

```text
/clear-context --work-item agentops-session-queue
/clear-context feature agentops-session-queue
/save-session --work-item review-gate-diffview
```

A user should never need to type a long generated filename to preserve context.

### 6.4 Startup behavior

Do not automatically inject the newest active record when more than one
resumable context exists.

Startup behavior:

- zero resumable contexts: start normally;
- exactly one clean resumable context: show a compact confirmation and allow
  automatic injection according to config;
- two or more resumable contexts: show a picker or a compact queue and wait for
  explicit selection;
- any stale/orphaned/conflicted context: show an attention summary, but do not
  silently resume it;
- non-interactive mode: inject no context by default and print machine-readable
  queue information for the caller.

Default safety policy:

```json
{
  "autoInjectSessionState": "prompt-when-multiple"
}
```

Backward-compatible boolean `true` may map to `prompt-when-multiple`, not to
“choose latest forever.”

### 6.5 Todo ownership

Each work item owns its own next-action list. The queue displays the first few
items from each work item.

There is no separate global todo file in the first implementation. This avoids
a second mutable source of truth.

A future global view may be derived from:

```text
work_item.next_actions
```

### 6.6 Cleanup policy

Never delete automatically.

Automatic operations may:

- mark records stale;
- mark records orphaned;
- rebuild the derived index;
- create a repair report;
- hide archived records from the default picker.

Destructive operations require explicit confirmation:

```text
/session-archive <work-item-id>
/session-delete <work-item-id> --confirm
/session-prune --preview
/session-prune --apply
```

### 6.7 Git and synchronization policy

Keep runtime session records local by default, consistent with the current
`.gitignore` policy. They may contain private prompts, paths, model names, or
sensitive context.

Optional future modes:

```text
local       .agents/sessions ignored by Git
tracked     user explicitly opts into tracking selected summaries
agentops    publish redacted summaries to AgentOps vault
```

The implementation must not silently start tracking private session content.

---

## 7. User Experience

### 7.1 Save from an active Pi session

The user may save with an explicit work item:

```text
/save-session --work-item feature-a
```

or a shorthand:

```text
/save-session feature feature-a
```

If the current Pi session already has a bound work item, the command updates
that identity by default.

### 7.2 Clear context

Expected flow:

```text
/clear-context
```

1. Build a checkpoint for the current session.
2. Resolve the current `work_item_id`.
3. Save the checkpoint atomically.
4. Mark the old harness session as paused/superseded.
5. Create a parent link for the new Pi session.
6. Start the fresh Pi session.
7. Show a resumable queue if multiple work items are available.

Optional explicit form:

```text
/clear-context --work-item feature-a
```

The command must never overwrite feature B merely because feature B was saved
more recently.

### 7.3 Queue view

Recommended command:

```text
/sessions
```

Default TUI view:

```text
Resumable Work Items — dotfiles

  1. ● feature-a / Pi       PAUSED     updated 4m ago
     Goal: implement feature A
     Branch: main           Worktree: main
     Next: add tests; verify config migration

  2. ● feature-b / Pi       STALE      updated 9d ago
     Goal: investigate feature B regression
     Branch: feat/feature-b  Branch missing
     Next: inspect failing integration test

  3. ! review-gate          ORPHANED   updated 12d ago
     Goal: review DiffView contract
     Problem: referenced worktree no longer exists

  [Enter] resume  [j/k] move  [a] archive  [r] repair  [?] help  [q] close
```

The display must be readable by both humans and screen/log parsers. Each item
should have a stable number and a stable ID.

### 7.4 Explicit resume

```text
/resume-session feature-a
/resume-session wi-feature-a-abc123
/resume-session 1
```

The command should accept:

- work-item ID;
- session ID;
- checkpoint filename;
- queue number for the current picker view.

Ambiguous short names must produce a choice list, not a guess.

### 7.5 Current work item

Add a command to bind the current Pi session:

```text
/session-use <work-item-id>
```

This prevents later `/save-session` and `/clear-context` calls from relying on
inference.

Display the binding in the Pi statusline:

```text
ctx 42%  work: feature-a  queue: 2 resumable
```

### 7.6 Completion and archiving

```text
/session-done
/session-pause
/session-archive <work-item-id>
```

`/session-done` should require a short completion summary and optionally ask
whether remaining next actions should be moved to a new work item.

---

## 8. Data Model

### 8.1 Work-item record

The following is a logical schema. The persisted format may remain Markdown
frontmatter plus structured sections for human readability.

```yaml
schema_version: 2
record_type: work_item
work_item_id: wi-agentops-session-queue-a1b2c3
identity_confidence: explicit
label: Multi-session context queue
slug: agentops-session-queue
status: paused
priority: normal
created_at: 2026-07-15T00:00:00Z
updated_at: 2026-07-15T00:10:00Z
last_checkpoint_id: cp-20260715-001000-d4e5f6
last_session_id: sess-pi-112233
harnesses: [pi]
repo_root: /Users/vietquocbui/dotfiles
worktree_path: /Users/vietquocbui/dotfiles
branch: main
head_at_checkpoint: abc1234
base_branch: main
parent_work_item_id:
parent_session_id: sess-pi-998877
source_session_file: /Users/me/.pi/agent/sessions/session.jsonl
agentops_note: Projects/2026-07-15_multi-session-context-queue.md
last_seen_at: 2026-07-15T00:10:00Z
stale_after_days: 14
stale_reasons: []
orphan_reasons: []
tags: [agentops, session, feature]
```

### 8.2 Human-readable body

```markdown
# Multi-session context queue

## TL;DR
Preserve independent Pi contexts and let the user choose which feature to resume.

## Goal
Implement a multi-session context queue for the repository.

## Current State
- Existing universal inbox creates separate files.
- Startup still selects only the latest active record.
- Multiple contexts need explicit selection.

## Next Actions
- [ ] Add stable work_item_id and session_id metadata.
- [ ] Add interactive queue picker.
- [ ] Add stale/orphan detection.
- [ ] Add atomic index reconciliation.

## Decisions
- Canonical store remains `.agents/sessions/`.
- AgentOps receives projections, not runtime truth.
- No automatic deletion.

## Files / Artifacts
- `scripts/agent-session`
- `pi/.pi/agent/extensions/pi-session.ts`

## Checkpoint History
- 2026-07-15T00:10:00Z — saved before context reset

## Resume Instructions
Start by implementing the queue picker, then add stale detection tests.
```

### 8.3 Checkpoint metadata

Every checkpoint must preserve:

```yaml
checkpoint_id:
work_item_id:
session_id:
parent_checkpoint_id:
harness:
harness_session_file:
saved_at:
repo_root:
worktree_path:
branch:
head_at_save:
working_tree_state: clean | dirty | unknown
changed_files_count:
next_actions_count:
```

### 8.4 Queue item projection

The derived queue item should contain only fields needed for selection:

```json
{
  "workItemId": "wi-feature-a-abc123",
  "label": "Feature A",
  "status": "paused",
  "priority": "normal",
  "updatedAt": "2026-07-15T00:10:00Z",
  "ageSeconds": 240,
  "harnesses": ["pi"],
  "branch": "main",
  "worktreePath": "/Users/me/repo",
  "goal": "Implement feature A",
  "nextActions": [
    "Add tests",
    "Verify config migration"
  ],
  "warnings": [],
  "checkpointFile": ".agents/sessions/feature-a.md"
}
```

---

## 9. Lifecycle State Machine

### 9.1 States

```text
                    ┌──────────────┐
                    │   running    │
                    └──────┬───────┘
                           save / clear
                              │
                              ▼
                    ┌──────────────┐
             ┌──────│    paused    │──────┐
             │      └──────┬───────┘      │
             │             │              │
       resume/use          │ age/invalid  │ done
             │             ▼              ▼
             │        ┌──────────┐  ┌───────────┐
             └────────│  stale   │  │ completed │
                      └────┬─────┘  └───────────┘
                           │ repair/confirm
                           ▼
                      ┌──────────┐
                      │ paused   │
                      └──────────┘

Any state with an unresolvable reference may additionally carry:
  orphaned=true

Archived is a terminal visibility state, not a data deletion state.
```

### 9.2 Required transitions

| From | Event | To |
|------|-------|----|
| running | save checkpoint | paused or running |
| running | clear context | paused; child session starts |
| paused | session-use/resume | running |
| paused | freshness/repository check fails | stale |
| stale | user acknowledges and repairs | paused |
| paused | session-done | completed |
| any non-archived | session-archive | archived |
| any | missing file/reference | orphaned flag |
| orphaned | repair/rebuild succeeds | previous valid state |

The implementation must record transitions in checkpoint history or a compact
event section so an AI can explain why a record is stale or archived.

---

## 10. Stale and Orphan Detection

### 10.1 Default stale threshold

Default:

```text
14 days since updated_at
```

Make configurable:

```json
{
  "sessionQueue": {
    "staleAfterDays": 14,
    "warnAfterDays": 3
  }
}
```

### 10.2 Stale reasons

A record becomes `stale` when one or more apply:

- last update exceeds the configured threshold;
- branch no longer exists;
- recorded worktree path no longer exists;
- recorded repository root no longer exists;
- recorded HEAD differs substantially from the checkpoint and the record has
  not been reviewed;
- parent session is missing and the record is not explicitly standalone;
- source harness session file is missing, when it was required for resume.

Not every Git change should block resume. The queue should distinguish:

```text
warning: branch advanced since checkpoint
blocking: worktree missing
informational: working tree was dirty at save
```

### 10.3 Orphan reasons

Mark `orphaned` when:

- an index entry points to a missing checkpoint file;
- a checkpoint has malformed frontmatter;
- a child points to a missing work-item ID;
- a worktree identity cannot be resolved;
- duplicate IDs cannot be deterministically reconciled;
- a legacy pointer references a missing file.

### 10.4 Repair behavior

```text
/sessions --repair
agent-session index <repo>
agent-session doctor <repo>
```

Repair must:

1. scan all session Markdown files;
2. parse valid frontmatter;
3. synthesize missing legacy IDs deterministically;
4. report malformed files without deleting them;
5. rebuild the derived index atomically;
6. preserve duplicate records and mark them `conflicted` if necessary;
7. write a repair report with counts and file paths.

---

## 11. Concurrency and Atomicity

Two Pi sessions may save simultaneously in the same repository. The following
rules are mandatory.

### 11.1 Per-record writes

Each checkpoint must write to a unique temporary file, then atomically rename:

```text
checkpoint.md.tmp.<pid>.<random>
→ checkpoint.md
```

Never write directly over a record using a partially completed stream.

### 11.2 Index writes

`index.json` is derived and must be rebuilt or merged safely:

1. acquire a short-lived lock, e.g. `.agents/sessions/.index.lock`;
2. read the current index and scan records as needed;
3. merge the new record by stable ID;
4. write a temporary JSON file;
5. atomically rename it to `index.json`;
6. release the lock.

If a lock is stale, report it and allow safe recovery after checking the lock
owner timestamp/process where supported.

### 11.3 No lost updates

A save from feature A must not remove feature B from the index. Tests must
simulate two writers and assert both records remain.

### 11.4 Duplicate handling

If the same stable checkpoint ID appears twice:

- retain both physical files;
- mark the index entry `conflicted`;
- do not silently choose one;
- provide a repair command.

---

## 12. CLI and Pi API Contract

### 12.1 `agent-session` commands

Existing commands remain compatible.

Add or extend:

```text
agent-session queue [repo] [--format human|json]
agent-session doctor [repo] [--format human|json]
agent-session bind --work-item <id> [repo]
agent-session resume <work-item-id|session-id|file> [repo]
agent-session pause <work-item-id|session-id> [repo]
agent-session done <work-item-id|session-id> [repo]
agent-session archive <work-item-id|session-id> [repo]
agent-session prune [repo] --preview|--apply
agent-session index [repo]
```

Recommended `list` extensions:

```text
--work-item <id>
--status running|paused|stale|orphaned|completed|archived
--sort updated|priority|status|age
--format human|json|tsv
--include-archived
```

### 12.2 Pi commands

Add or extend:

```text
/sessions                         # interactive queue picker
/sessions --json                  # machine-readable queue
/sessions --repair                # repair/rebuild index
/session-use <id|number>          # bind current Pi session
/session-pause                    # pause current work item
/session-done                     # complete current work item
/session-archive <id|number>      # archive with confirmation
/session-prune                    # preview stale/orphan cleanup
/resume-session <id|number|file>  # explicit resume
```

Existing commands must remain valid:

```text
/save-session
/clear-context
```

### 12.3 `clear-context` arguments

Support:

```text
/clear-context
/clear-context --work-item <id>
/clear-context --slug <feature-name>
/clear-context --no-prompt
```

`--no-prompt` is for automation only. If multiple contexts exist and no
work-item identity is bound, it must not guess silently; it should save the
current context under a provisional ID and report the queue.

---

## 13. Startup and AI Injection Contract

### 13.1 Human-interactive Pi startup

At session start:

1. discover repository root;
2. load/rebuild the session queue;
3. resolve current Pi session identity;
4. detect whether this is a child of a previous `clear-context` session;
5. determine candidate work items;
6. if one clean candidate exists, show a confirmation;
7. if multiple candidates exist, show the picker;
8. inject only the selected work item;
9. record the selection and heartbeat.

### 13.2 Non-interactive startup

Do not inject arbitrary context. Return a bounded JSON object:

```json
{
  "selected": null,
  "reason": "multiple_resumable_work_items",
  "items": [
    {
      "workItemId": "wi-feature-a-abc123",
      "goal": "Implement feature A",
      "nextActions": ["Add tests"]
    }
  ]
}
```

### 13.3 AI-readable prompt block

When context is injected, use an explicit bounded block:

```markdown
<session-queue-context>
Selected work item: wi-feature-a-abc123
Label: Feature A
Status: paused → running
Repository: /Users/me/repo
Branch: main
Checkpoint: cp-20260715-001000-d4e5f6

Goal:
Implement feature A.

Next actions:
1. Add tests.
2. Verify config migration.

Warnings:
- Branch advanced by 2 commits since checkpoint.

Resume rule:
Do not assume this context applies to other queue items.
</session-queue-context>
```

This makes context boundaries visible to the AI and reduces accidental mixing
between features.

---

## 14. AgentOps Projection

AgentOps is a durable human-memory and dashboard layer, not the runtime source
of truth.

For each work item, optionally maintain:

```text
~/repos/AgentOps/Runs/<project>/<work-item-id>.md
```

The projection should include:

- work-item ID;
- label and goal;
- current status;
- latest checkpoint ID;
- repository/branch/worktree;
- next actions;
- stale/orphan warnings;
- links to local checkpoint files;
- compressed history;
- no raw transcript dump.

Projection updates must be best effort. Failure to update AgentOps must not
prevent the local session checkpoint from being saved.

### 14.1 Obsidian folder correction

The current note bridge has generated notes under:

```text
AgentOps/Sessions/Specs/
```

The intended AgentOps contract is:

```text
AgentOps/Projects/   # specs, plans, designs, architecture
AgentOps/Reviews/    # reviews and PR notes
AgentOps/Runs/       # run/work-item projections
AgentOps/Inbox/      # quick captures
```

The implementation must:

1. update the effective user config, not only the dotfiles default;
2. migrate or preserve existing `Sessions/` notes safely;
3. make `Projects/` the default for `spec`, `plan`, `design`, and `arch`;
4. add a regression test that resolves a spec note to `Projects/`.

---

## 15. Migration Plan

### 15.1 Existing universal inbox records

Do not delete existing records.

For every existing session file:

1. parse frontmatter;
2. assign a deterministic `work_item_id` if missing;
3. assign a deterministic `session_id` if missing;
4. assign a generated `checkpoint_id` if missing;
5. copy `goal` into `label` when no label exists;
6. map existing `active` records to `paused` unless a live heartbeat proves
   they are running;
7. preserve the original filename;
8. rebuild `index.json`.

### 15.2 Legacy per-harness pointers

Keep these files as thin pointers:

```text
.claude/session-state.md
.codex/session-state.md
.opencode/session-state.md
.pi/session-state.md
```

Each pointer should identify the selected or last-used work item, but must not
be treated as the complete queue.

### 15.3 Current single-state `.Codex/session-state.md`

If present, import it as a legacy checkpoint:

```text
legacy_source: .Codex/session-state.md
migration_status: imported
```

Do not overwrite it until the user confirms migration. After import, the
legacy file may become a pointer consistent with the other harness pointers.

### 15.4 Existing stale records

The first migration must produce a report:

```text
Found: 7 session records
Resumable: 2
Stale: 4
Orphaned: 1
Completed: 0
```

The user chooses whether to archive any records. Migration must not guess that
old means disposable.

---

## 16. Configuration

Extend `shared/agent-workflow.default.json`:

```json
{
  "universalSessionInbox": true,
  "piSessionInbox": true,
  "autoInjectSessionState": "prompt-when-multiple",
  "sessionQueue": {
    "enabled": true,
    "storage": "repo",
    "directory": ".agents/sessions",
    "defaultWorkItemPrompt": true,
    "defaultStaleAfterDays": 14,
    "warnAfterDays": 3,
    "autoArchive": false,
    "autoDelete": false,
    "startupMode": "prompt-when-multiple",
    "projection": "agentops-best-effort",
    "allowSameBranchMultipleWorkItems": true,
    "allowConcurrentSaves": true,
    "maxQueueItems": 12
  }
}
```

Backward compatibility:

```text
true  → prompt-when-multiple
false → disabled
string values → new explicit policy
```

Per-repository overrides may change thresholds and projection behavior.

---

## 17. Security and Privacy

Session checkpoints can contain:

- user prompts;
- local file paths;
- repository names;
- model/provider names;
- operational details;
- accidental secrets in tool output.

Required protections:

- redact obvious secrets before AgentOps projection;
- do not copy raw JSONL into AgentOps by default;
- keep local checkpoint storage ignored unless explicitly tracked;
- do not print full checkpoint bodies in queue listings;
- use bounded output lengths;
- make remote/cross-machine sync opt-in;
- preserve file permissions inherited from the repository;
- avoid embedding credentials in frontmatter or logs.

---

## 18. Acceptance Criteria

### Multiple contexts

- Two Pi sessions in the same directory can save independently.
- Saving feature A never removes feature B from the queue.
- Two active/resumable features are both visible after restart.
- The user can select either feature by number or stable ID.

### Clear-context

- `/clear-context` saves the current feature before resetting context.
- The saved checkpoint contains goal, current state, next actions, files, Git
  context, and source session reference.
- A child session retains a parent link.
- Repeated clears do not create unbounded duplicate logical work items.

### Startup

- One clean context may be offered for confirmation.
- Multiple contexts trigger selection instead of newest-only injection.
- Stale/orphaned contexts are visible and labeled.
- Non-interactive mode never guesses among multiple contexts.

### Lifecycle

- `/session-done` marks only the selected work item completed.
- `/session-archive` hides but does not delete.
- `/session-prune --preview` reports candidates without mutation.
- No automatic destructive cleanup occurs.

### Concurrency

- Concurrent saves preserve all records.
- Index writes are atomic.
- Index rebuild recovers from a missing/corrupt index.
- Duplicate IDs produce a visible conflict, not silent data loss.

### Migration

- Existing session files remain available.
- Legacy pointers continue to work.
- `.Codex/session-state.md` is imported safely.
- Existing stale/orphaned records receive actionable classifications.

### AgentOps

- Projections are best effort and never block local saves.
- Specs/plans/designs resolve to `AgentOps/Projects/`.
- Runtime queue state remains `.agents/sessions/`.

---

## 19. Test Plan

### 19.1 Unit tests

Test:

- ID generation and collision resistance;
- slug normalization;
- frontmatter parsing and serialization;
- legacy record migration;
- status transitions;
- stale reason calculation;
- orphan detection;
- queue sorting;
- bounded human and JSON output;
- secret redaction;
- deterministic legacy IDs.

### 19.2 Integration tests

1. Create feature A session and save.
2. Create feature B session in the same repository and save.
3. Clear feature A.
4. Clear feature B.
5. Rebuild the index.
6. Assert both work items appear.
7. Select A and assert only A is injected.
8. Select B and assert only B is injected.

### 19.3 Concurrency test

Launch two save operations concurrently with different work-item IDs and
assert:

```text
index contains A
index contains B
both checkpoint files exist
index JSON is valid
```

### 19.4 Stale/orphan test

Create records with:

- old `updated_at`;
- missing worktree;
- missing branch;
- missing checkpoint file;
- malformed frontmatter.

Assert each receives the correct warning without deletion.

### 19.5 Migration test

Seed legacy files with only:

```yaml
status: active
```

Run migration and assert:

- valid deterministic IDs are added;
- original files are preserved;
- queue does not auto-select all legacy records;
- repair report is generated.

### 19.6 Pi smoke test

From a real Pi session:

```text
/session-use feature-a
/clear-context
/session-use feature-b
/clear-context
/sessions
/resume-session feature-a
```

Verify the context picker and injection behavior.

### 19.7 Obsidian smoke test

```text
/spec multi-session-context-queue
```

Verify the note lands under:

```text
~/repos/AgentOps/Projects/
```

---

## 20. Implementation Order

### Phase A — Data compatibility

- Extend `scripts/agent-session` schema.
- Add stable IDs and lifecycle fields.
- Keep current save/list/show/resume commands compatible.
- Add index rebuild and migration logic.

### Phase B — Queue and lifecycle

- Add queue projection and sorting.
- Add stale/orphan detection.
- Add `doctor`, `pause`, `done`, `archive`, and `prune --preview`.
- Add atomic lock/reconciliation behavior.

### Phase C — Pi integration

- Replace latest-only startup selection.
- Add interactive `/sessions` picker.
- Add `/session-use` binding.
- Extend `/clear-context` with work-item identity and parent links.
- Inject explicit bounded context blocks.

### Phase D — AgentOps projection

- Correct effective vault folder configuration.
- Add work-item/run projection template.
- Keep projection failure non-blocking.
- Add dashboards for resumable/stale/orphaned work.

### Phase E — Migration and rollout

- Run migration in report-only mode.
- Review stale/orphan report.
- Enable prompt-when-multiple by default.
- Keep auto-delete disabled.
- Run integration and concurrency smoke tests.

---

## 21. AI Implementation Guidance

An AI implementing this feature must follow these rules:

1. Read and preserve existing `agent-session` CLI compatibility.
2. Treat `.agents/sessions/` as canonical runtime state.
3. Treat `index.json` as derived/rebuildable metadata.
4. Never use “latest active record” as the only selection algorithm.
5. Never silently choose when multiple work items are plausible.
6. Never delete stale or orphaned records automatically.
7. Preserve unknown frontmatter fields during migration.
8. Use atomic file replacement for Markdown and JSON writes.
9. Keep concurrent saves from dropping unrelated records.
10. Keep raw transcripts out of normal queue output.
11. Make status and warning reasons explicit in both human and JSON output.
12. Do not couple local resume success to AgentOps or Obsidian availability.
13. Add tests before changing the startup injection behavior.
14. Verify the effective user config, not only the checked-in default config.
15. Keep a migration report and make repair reversible.

---

## 22. Definition of Done

This SPEC is implemented when a user can work like this without context loss:

```text
Terminal 1 / Pi:
  feature-a
  /clear-context

Terminal 2 / Pi:
  feature-b
  /clear-context

Next Pi session:
  /sessions
  → choose feature-a or feature-b
  → inspect its goal and next actions
  → resume only the selected context
```

The user can then inspect the other work item later, with its own context,
without stale records causing silent selection or orphaned state being deleted.
