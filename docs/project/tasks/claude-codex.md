---
id: claude-codex
title: Claude to Codex continuity
status: review
updated: 2026-11-02
tags: [project, task]
---

# Claude to Codex continuity

Continue in Codex when Claude usage is exhausted, preserving the same worktree,
branch, dirty files, review state and existing Pi dispatch.

## Current observation

Design/plan reviewed by independent planner; three contract gaps resolved.
User approved implementation on 2026-11-02. Commands are implemented in feature
history with fixture tests and a read-only live Codex Luna handoff. No global
activation, push or merge performed. Desktop/Claude live return remains unverified.

## Artifacts

- [Design](../../superpowers/specs/2026-11-02-claude-codex-takeover-design.md)
- [Plan](../../superpowers/plans/2026-11-02-claude-codex-takeover.md)
- [Documentation companion](repo-docs.md)

## Next action

Review implementation and integrate through normal workflow; run the optional
Desktop/Claude interactive pilot before claiming full parity.

## Implementation guide

- [Commands and verification](../../workflows/claude-codex-takeover.md)
