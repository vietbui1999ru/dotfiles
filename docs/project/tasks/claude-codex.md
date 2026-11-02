---
id: claude-codex
title: Claude to Codex continuity
status: proposed
updated: 2026-11-02
tags: [project, task]
---

# Claude to Codex continuity

Continue in Codex when Claude usage is exhausted, preserving the same worktree,
branch, dirty files, review state and existing Pi dispatch.

## Current observation

Design/plan reviewed by independent planner; three contract gaps resolved.
Runtime implementation awaits human design review. Planning commit: 920f6c8.
No claim that takeover commands are implemented or installed.

## Artifacts

- [Design](../../superpowers/specs/2026-11-02-claude-codex-takeover-design.md)
- [Plan](../../superpowers/plans/2026-11-02-claude-codex-takeover.md)
- [Documentation companion](repo-docs.md)

## Next action

Review design, then implement bounded tasks through existing dispatch/review.
