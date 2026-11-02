# Agent handoff and project checks

From the implementation checkout, invoke `./scripts/agent-session` and
`./scripts/agent-project` directly. The shorter commands below become available
after normal branch integration and existing bootstrap; no global activation
was performed from this feature worktree.

Use these commands to coordinate a handoff between Claude Code and Codex in the **same checkout**.

## Handoff from Claude Code to Codex

```sh
agent-session handoff --from cc --to codex --reason usage-exhausted --stdin WORKTREE
```

This saves a bounded checkpoint. The JSON output includes the checkpoint filename.

Omit `--stdin` for factual recovery without model calls.

## Take over with Codex

```sh
agent-session takeover NOTE --harness codex --dry-run WORKTREE
```

`--dry-run` validates the takeover without launching Codex.

To launch Codex in the same checkout, release the current owner first, then run:

```sh
agent-session takeover NOTE --harness codex --owner-released WORKTREE
```

For Desktop, add `--prepare-only` to the `--owner-released` takeover command.
After dry-run and stopping the old writer, it prints a claim token and prompt.
Select the same folder in Desktop and provide that prompt. Stop the Desktop
writer before releasing only the matching claim:

```sh
agent-session release TOKEN --owner-released WORKTREE
```

Existing writers must stop before takeover; save the handoff before stopping. An attestation cannot be inferred.

## Return to Claude Code

Before stopping Codex, create a return checkpoint with its completed work,
remaining questions and next action:

```sh
agent-session handoff --from codex --to cc --reason return --parent-checkpoint NOTE --stdin WORKTREE
```

After saving, stop Codex and release its claim. The human reopens the original
Claude session/worktree and explicitly loads the return checkpoint.

## Implementation and review

Pi/pueue remains the implementation lane. Handoffs do not change pending reviews or approvals.

## Project tools

- `agent-project view WORKTREE --task ID` writes an ignored, common-root local overlay.
- `agent-project check-artifacts WORKTREE --artifact PATH` validates committed bytes before already-authorized pruning. It never prunes.
- `agent-project publish-check WORKTREE --manifest JSON` validates an explicit public-page allowlist. It never deploys.

Native hook/UI parity and Obsidian rendering parity are unverified.

## Limits and ownership

Claims coordinate users of these commands; they do not stop arbitrary writers.
Unavailable pueue status is reported unknown, and owner-release attestation
remains required. No auto-switch, process kill, lock removal or approval occurs.

A handoff lacking a model summary contains factual Git recovery information,
not recovered conversation history. A branch mismatch refuses takeover; HEAD
drift is reported for inspection. New handoffs preserve main legacy pointers.

## Documentation and runtime views

Curated task records live in docs/project/tasks/ and stay separate from live
Pi/pueue authority. The local overlay is ignored, common-root and partitioned by
worktree. Use --pi-task ID (repeatable) to observe existing pi-outcome reports.

Before already-authorized cleanup, enumerate every required artifact with
repeatable --artifact PATH. Missing, dirty or untracked files block the check.
This verifies preservation at HEAD; it neither copies nor prunes worktrees.

Publish manifests use repo-relative paths and an explicit pages array. The
validator is a portable-Markdown selection gate, not a renderer or permission
to deploy. Reuse the repo's existing site generator; no new framework selected.

## Verification record (2026-11-02)

Fixture tests cover identity, concurrent writes/claims, dirty-file preservation,
manual claim/release and return linkage. A read-only live Codex Luna subprocess
received the checkpoint, confirmed goal and feat/pilot branch, exited zero and
released its claim. A bounded Pi Luna subprocess drafted this guide; planner
corrected return ordering and command prefixes before committing.

Interactive Desktop continuity, an actual Claude session return, live human
review approval, hosted rendering and Obsidian reading-view remain unverified.
The disposable pilot did not alter any existing session or approve a review.
