---
name: context-switch
description: Use when Claude usage is exhausted and Codex must explicitly continue the same worktree task, or when handing that task back to Claude.
---

# Claude and Codex context continuity

Use the existing agent-session CLI and shared inbox. This skill does not grant
approval, change provider automatically, create a new checkout or replace Pi.
Keep planning/orchestration on Sol/Opus-class; use Luna/Haiku-equivalent for
scouting and bounded mechanical implementation with explicit file scopes/checks.
Validate installed model IDs and avoid consuming the exhausted Claude pool.

## Choose context explicitly

Read applicable instructions and canonical shared/AGENTS.md from the dotfiles
checkout; do not assume Claude @imports load in Codex. Use git worktree list
--porcelain to inspect topology. Never switch another branch for discovery.
Read branch-local SPEC.md and linked plan before editing.

Use `agent-session list <worktree>` and `show <note.md> <worktree>`; inspect
worktree/head/branch metadata. Do not choose repository-wide newest active note
blindly. Old notes lacking identity need a fresh explicit handoff in the target
checkout. Storage is common repo .agents/sessions; .pi review state and task
SPEC/plan belong to the selected worktree, not the main checkout.

## Claude to Codex

While Claude can still summarize, pipe a bounded Goal/Completed/In Progress/
Decisions/Blocked/Files Modified/Next Session Should summary into:

```sh
agent-session handoff --from cc --to codex --reason usage-exhausted --stdin <worktree>
```

Include task ID via --task, source ID via --source-session if known, plan/spec
paths and observed check results. Never include credentials or raw transcripts.
If Claude is already exhausted, omit --stdin: factual local recovery requires
no model call. That is incomplete context, not a claim of completed work.

Stop the old writer. Git worktree locks do not prove that it stopped. Inspect:

```sh
agent-session takeover <note.md> --harness codex --dry-run <worktree>
agent-session takeover <note.md> --harness codex --owner-released <worktree>
```

Only the human or already-authorized owner can attest --owner-released. An agent
must not invent this attestation merely to pass validation. Live pueue writers
block takeover; unavailable probing means unknown interactive ownership. Claims
coordinate this command's users, not arbitrary tools that ignore the protocol.
The CLI launches `codex -C <same-worktree>` with a checkpoint pointer. No
--worktree, resume --last, reset, copied working files or branch movement.

For Desktop, use --prepare-only with --owner-released after dry-run. It returns
a claim_token and context prompt. Human selects the same folder and supplies
that prompt. Verify the claim's worktree and checkpoint before edits. After
stopping that Desktop writer, release only its own claim token:

```sh
agent-session release <claim-token> --owner-released <worktree>
```

Never remove another owner's claim or Git lock. Leftover claims require human
investigation; there is no automatic reclaim. CLI claims release when the child
returns. Missing access requests go through normal approval for the specific
checkpoint/canonical-rules path; do not broaden access to all worktrees.

## Preserve review and return

Read pending reviews in <worktree>/.pi/agent-review/pending without approving or
changing them. Keep existing Pi/pueue dispatch, review gates, commit-funnel and
jj rules. Search explicit hidden roots using rg --hidden --no-ignore or fd -HI;
exclude credentials, .git objects, dependencies and unrelated transcripts.

Save Codex's summary with `handoff --from codex --to cc --reason return
--parent-checkpoint <original.md> --stdin <worktree>`. Stop Codex and release
its claim; human reopens original Claude session and explicitly reads the
return checkpoint. Native Codex hooks/UI parity remains unverified; do not
infer it from successful context transfer or fixture tests.
