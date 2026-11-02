---
id: claude-codex
title: Claude to Codex continuity
status: done
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

## Merge and activation (2026-11-02)

Merged locally into main by explicit user approval, then activated command
links, shared skills and Codex worker models through targeted changes. Existing
local edits and hooks were preserved. All 89 post-merge regression tests and
installed-command checkpoint/claim/release/view smoke checks passed. No remote
push or worktree deletion performed. Interactive Desktop/Claude return and
Obsidian/host rendering remain unverified.
