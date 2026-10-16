---
name: session-overview
description: Summarize current Codex session context, Git state, worktrees, and queued Pi tasks when the user asks what is happening or what is running.
---

# Session Overview

Give a concise, read-only snapshot of the current work session. Codex's built-in
status line and `/status` command provide model, context, usage, and run state.
Use this skill for the repository, worktree, and Pi handoff details that the
native status line does not show.

## Workflow

1. Run `git status --short --branch` and `git worktree list --porcelain` from
   the current repository.
2. If `pueue` is installed, run `pueue status --json`; summarize queued,
   running, and paused tasks. Do not alter task state.
3. Report the current branch, changed-file count, worktrees, and active Pi
   tasks. Mention unavailable data instead of guessing.

Do not read session transcripts, inspect credentials, or run mutating commands.
