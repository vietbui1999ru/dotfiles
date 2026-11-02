---
id: repo-docs
title: Documentation companion and durable project view
status: done
updated: 2026-11-02
tags: [project, task]
---

# Documentation companion and durable project view

Maintain linked documentation alongside code, with hostable reading and an
Obsidian-friendly repo-local view. Git shares curated history; runtime stays local
(user decision, 2026-11-02).

## Current observation

Repo-docs skill, layout guidance and five reusable templates are prepared in
this branch. Existing worker is sufficient; no new agent roster required.
Bootstrap discovery is configured but has not been deployed to live tools.
On-demand agent-project view, committed-artifact preservation checks and public
allowlist validation are implemented. No hosted framework, public deployment,
projection daemon or automatic pruning hook added.

## Artifacts

The integration plan and task links below work inside a docs-only vault. Skill
and layout source links require a repo-root vault, Git viewer or editor; use
the repo-root vault for this pilot. No vault configuration is installed.

- [Skill](../../../shared/skills/repo-docs/SKILL.md)
- [Layout contract](../../../shared/skills/repo-docs/references/layout.md)
- [Remaining integration plan](../../superpowers/plans/2026-11-02-repo-docs.md)
- [Related takeover task](claude-codex.md)

## Next action

A bounded Pi Luna draft produced the takeover guide, then planner reviewed and
corrected it. Review the implementation and select a host renderer for a real
site. Obsidian visual verification awaits an explicitly opened repo-root vault.

## Merge and activation (2026-11-02)

Merged locally into main by explicit user approval, then activated command
links, shared skills and Codex worker models through targeted changes. Existing
local edits and hooks were preserved. All 89 post-merge regression tests and
installed-command checkpoint/claim/release/view smoke checks passed. No remote
push or worktree deletion performed. Interactive Desktop/Claude return and
Obsidian/host rendering remain unverified.
