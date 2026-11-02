# Layout and publication contract

Default for repos without established docs. Adopt existing paths when present;
this is a layout template, not a migration instruction.

```text
docs/
  index.md                  project entry point and what's new
  guides/                   user tasks and quickstarts
  reference/                verified interfaces and behavior
  architecture/             system overview and boundaries
  decisions/                dated architectural decisions
  changes/                  meaningful feature/change records
  project/
    index.md                curated current tasks and recent decisions
    tasks/<task-id>.md      durable purpose, state, evidence and artifact links
  specs/                    existing completed SPEC archive
  superpowers/plans/        existing tracked plans; retain current convention
.agents/project-view/<worktree-id>/current.md  ignored local overlay
```

Use [home template](../assets/index.md), [task template](../assets/task.md),
[feature template](../assets/feature.md), [decision template](../assets/decision.md)
and [site navigation template](../assets/site-layout.md) selectively. Braced
fields are authoring inputs and must be resolved before adding pages to a repo.
Empty sections should be omitted, not published as template placeholders.

Each curated task has stable id, title, status, updated date and related IDs.
Suggested states: proposed, active, blocked, review, done, cancelled. State is a
human-readable observation with evidence; done requires final validation and
review, never just worker exit zero. Shared owner/team assignments are optional;
local session occupancy is never a curated assignment. Conflicting updates are
ordinary Git review conflicts; runtime writers never rewrite the shared board.

Per-task links name the actual SPEC/plan/archive, decision, change page and code
commit/PR. When the artifact is still local, display "local draft; not shared"
instead of a broken worktree path. Before cleanup preserve the unique artifact,
then replace that label with its tracked commit/path. Durable tasks may link
source code at a commit; avoid line numbers that silently drift with HEAD.

Repo-local view: docs/project/index.md is stable navigation. Each person's
ignored overlay lives at the main checkout's .agents/project-view/, never solely
inside a disposable worktree. Overlay shows worktree, task IDs, observed-at,
existing stream/review pointers and available handoffs. It is a view of current
authorities and must show stale/unknown after a missing source. No new runtime
writer/generator is provided by this skill; projection automation is a later
bounded task. Leave existing ignores intact; add .agents/project-view/ only when
creating a local overlay. Do not broadly ignore tracked docs or all .agents.

Hosting default: publish guides, reference, architecture and selected changes
only. Maintain explicit per-project navigation/allowlist. Project tasks, SPECs,
plans and decisions remain collaborator-readable in Git but excluded from public
site output unless explicitly selected and reviewed. Public selection is distinct
from remote Git sharing. Keep one source body and build derived HTML/MDX with the
repo's existing tooling; do not apply llm-wiki's generator to unrelated repos.

Obsidian interoperability: quoted scalar properties, list-valued tags/aliases,
relative Markdown links with .md extensions, unique note IDs. Readable tables,
code fences and Mermaid are acceptable; test Mermaid in both target renderers.
If a repo uses wikilinks, ensure its existing build resolves them and checks
unresolved targets. No nested vault or .obsidian configuration is created by
this skill. The human may open docs/ as a vault; code links outside docs/ still
work in Git/site contexts but may need repo-root vault for Obsidian navigation.
