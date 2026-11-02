---
name: repo-docs
description: Use when maintaining repository documentation alongside code changes, recording durable project tasks and decisions, or preparing linked Obsidian-friendly and hostable Markdown documentation.
---

# Repository documentation companion

Read the repo's instructions, current branch SPEC, plan, existing docs layout,
and changed code before writing. Reuse existing documentation automation and
style. If the current checkout is this dotfiles repo, llm-wiki's docs-sync is a
separate wiki-specific publisher, not a generic project docs generator.

## Work alongside implementation

Use the existing worker and Pi/pueue dispatch, with a docs-only file scope and
this skill as context. Cheap model: inventory, links, factual drafts, mechanical
updates; strong planner: architecture synthesis, disputed behavior, specs and
review. Do not create another scheduler or agent roster.

Parallel writing requires disjoint assigned files and separate worktrees. One
docs owner maintains navigation/task records; code workers return change notes,
commands and results to that owner. The planner integrates documentation commits
through normal review; never write another agent's checkout. Draft against a
named commit or patch; after code settles, reconcile docs against final diff.
Mark planned behavior as planned. Never report it shipped from a draft spec.

A docs handoff includes task ID, repo/worktree, base/head or patch reference,
exact docs scope, source plan/spec, behavior changed, validation evidence,
audience and publication scope. Return changed pages, links checked, evidence
and unresolved questions. Follow existing commit/approval rules.

## Durable and local views

Read [layout.md](references/layout.md) when bootstrapping a repo or choosing
storage/publication. Use its assets as optional templates; adapt existing paths
instead of moving current files. Never copy templates over existing docs.

Durable curated history belongs in tracked Markdown under docs/. Runtime is
ignored under the main checkout's .agents/project-view/, partitioned by
worktree ID. A shared task ID connects docs, specs, plans and runtime records.
There is no second task engine: curated task status is a dated observation,
not a lock or replacement for pueue/Pi/review state. Ignore .obsidian workspace
and personal settings. Do not track session IDs, PIDs, local absolute paths,
provider usage or transcripts in curated records.

Before any authorized worktree pruning, inventory each SPEC, plan and handoff:
reference an already durable tracked file or preserve unique necessary content
as a reviewed durable record on the feature branch. Record commit/path, stable
ID, parent task and summary. Merely linking into .claude/worktrees or ignored
.agents is not preservation. Missing durable content blocks cleanup. This skill
does not authorize pruning, push, publication or spec approval. Do not archive
an active SPEC early: obey existing check/floor-guard and last-commit archive
rules. Preserve completed handoff conclusions, not raw conversations. Explicit
human deletion rules still apply; no automatic retention/deletion is installed.

## Traceability and evolving docs

Update affected behavior/reference/how-to pages, relevant decision records,
task links, and a concise what's-new entry for meaningful changes. Include the
why, compatibility impact and verified code references; avoid per-tool-call
journals. Stable IDs and parent links survive title/path changes. Fix inbound
links when an approved rename occurs. Add only pages needed by the change.

Use YAML properties and relative Markdown links by default for dual hosted/local
reading. Obsidian supports Markdown links; wikilinks/callouts/embeds are opt-in
only when the site's existing renderer handles them. Never maintain two manually
edited bodies for the same documentation. Generated site output stays generated.

## Obsidian and hosting

Obsidian is optional, not required to write or build docs. Use an explicitly
selected vault/path with available obsidian-mcp tools; discover capabilities,
never invent names. Otherwise inspect `obsidian help` and use explicit
`vault=<name>` and `path=<vault-relative-note>` with obsidian-cli. Never default
to the active vault/file. Report unavailable connectors and use filesystem
Markdown checks. Do not install plugins or alter vault settings implicitly.

A repo docs/ folder can be opened as its own vault by the human. If projecting
into an existing private vault, make projection direction and source explicit;
no bidirectional copy, no only durable copy in the private vault. Do not create
vault links or write outside the assigned repo without authorization.

Reuse the project's host framework and navigation. New repos start from plain
Markdown layout; selecting/installing a site framework and deploying is a
separate explicit task. Use a reviewed publication allowlist: being tracked or
`publish: true` alone is not permission to deploy. Exclude local runtime, task
work orders, private plans/specs and .obsidian settings from public output.

## Completion evidence

Report code revision reviewed; documentation touched; relative-link/frontmatter
validation; existing docs build result if applicable; Obsidian check status;
public/private selection; durable artifact preservation status. Missing Obsidian
or host build means unverified rendering, not failure of plain Markdown. Never
claim a visual check, backlinks check or deployment that did not run.
