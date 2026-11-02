# Hosted navigation template

Use the existing site's configuration format; this is an information layout,
not an executable site config or deployment permission.

- Start: docs/index.md (public variant omits internal Project work navigation)
- Learn: docs/guides/
- Interfaces: docs/reference/
- Design: docs/architecture/
- What's new: selected docs/changes/ pages

For a new site, review framework choice as a separate task. Build public
navigation from an explicit page allowlist; do not recursively publish docs/.
Private project index, task orders, specs, plans and local runtime stay excluded.
A public page's links must resolve entirely within the publication set or to
reviewed external URLs. Strip or replace internal trace sections in derived
public output; keep canonical Markdown unchanged. Fail the build on unresolved
public links. Do not replace missing pages with links to private worktrees.
