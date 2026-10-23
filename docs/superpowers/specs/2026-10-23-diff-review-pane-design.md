# Diff review pane — design (2026-10-23)

Status: design for approval. Lives in `~/dotfiles` (session-band) for now; it migrates to `~/repos/agent-harness` later with the rest of the agent configuration. The multi-person and live co-editing extension is a separate proposal: `~/repos/agent-harness/docs/proposals/2026-10-23-team-review-service.md` (branch `docs/team-review-service`).

## Intent

Review of agent work is split today. Pi runs are reviewed one way, in Neovim (`:AgentReview`), and the result reaches Pi as a decision file. Specs are approved through `ac-run`. Claude sessions' file changes have no review at all. The `/gates` pane lists what waits, but reviewing happens elsewhere, and nothing lets the agent answer the reviewer.

The pane makes review one place and a conversation: for every unapproved change in the worktree, a tab per file shows a highlighted diff; the person comments, asks, or edits the code in the tab; the agent that made the change answers in that file's thread, and pushes back ("clapback") when a comment or edit would break something or makes no sense; the person can overrule; approval happens in the same pane.

## Priorities (the person's, in order)

1. **Reliability.** Nothing the person writes is lost; each note reaches the agent exactly once; the pane always says where a note stands.
2. **Conversation.** A per-file thread with the agent, clapbacks included.
3. **Cost.** Matters, but never at the expense of 1 or 2.

## Goals

- One tab per unapproved file in the current worktree, from any agent: the current Claude session, other Claude sessions, and Pi runs.
- A highlighted, scrollable diff per tab, with line comments, questions, and direct code edits.
- A per-file thread with the original agent, delivered reliably, including clapbacks.
- Approval, per agent, from the pane, through the existing human-only dialog.
- `/gates` becomes the index: selecting a row opens the pane on that agent's files.

## Non-goals

- Several people reviewing at once, or live co-editing (the agent-harness proposal).
- Replacing `agent-review` or `ac-run` storage formats beyond what this design needs.
- Agents approving anything. Approval stays the person's, as today.

## Anti-goals (a failure even if it works)

- A note that silently disappears, or an Allow-looking state that is not.
- An approval an agent could trigger.
- A switch of model that silently re-reads a long context uncached.
- Comments written into source files.

## What counts as unapproved

An **agent** here is one Claude session or one Pi run. Each has a set of unapproved files:

- **Pi run**: the files of its pending `agent-review` record (`<worktree>/.pi/agent-review/pending/<runId>.json`), as today.
- **Claude session**: every file the session touched since its last approval. The person decided this definition.
  - A hook records the paths each Edit, Write or NotebookEdit call changes.
  - Bash can change files too, so the worktree is snapshotted before and after each Bash call and the changed paths are added. The snapshot method is `agent-review`'s (a tree object built in a throwaway index, so the real index is untouched). *Builder's call how to keep this fast; designer's call that Bash is covered.*
  - Approving records a snapshot of the approved files and clears the session's set. Files touched afterwards appear again.
- **Specs** (`SPEC.md`, `specs/*.md` whose `branch:` matches): shown as a review item that is not a diff. The tab shows each acceptance criterion with its verify command, the latest `ac-run check` result, and the spec text. Approval runs `ac-run approve` (its own dialog).

Blast-radius is not part of this. It approves a Bash command before it runs, not a file change afterwards.

## The thread

- One thread per (agent, file). Entries, in order: the person's comment or question (anchored to a line or hunk), the person's proposed patch, the agent's reply, the agent's clapback (a reply that disagrees, with a reason and usually an alternative patch), the person's overrule, and system entries (delivered, landed, approved).
- Stored durably on disk, per worktree, before the pane shows an entry as sent. *Builder's call: file format and location; designer's suggestion: next to the review record, for example `<worktree>/.pi/agent-review/threads/`, and an append-only JSONL file per thread.* A durable-agent store (pi-durable) is deliberately not required for this phase.
- Survives pane close, session restart and machine restart.

## Delivery to the original agent

The person decided replies come from the **agent that made the change**, because it knows why it made it, and its cached context keeps a reply cheap.

- **Send** writes the batch (every new entry for that agent, across its files) to disk with a batch id, then queues it.
- **Wait for the turn to end.** The person decided notes never interrupt work in progress. If the agent is mid-turn, the batch waits; when the turn ends, the whole batch goes in as one message.
- **Claude session**: delivered into that session. In the same session, at the end of the turn; in another session, through Claude Code's session messaging. *Builder's call which engine mechanism.* If the session has ended, the batch stays queued and the pane offers to resume it.
- **Pi run**: delivered by resuming the run's own Pi session with `pi --session-id pueue-<slug> -p "<batch>"`, dispatched through pueue as `plan-handoff.md` describes (explicit model, `-w <worktree>`, `< /dev/null`). This is mechanical: the pane builds the prompt from the thread; no model routes it.
- **Exactly once**: delivery is at-least-once with the batch id, and the agent's reply names the batch id it answers, so a redelivered batch is recognised and shown once.
- **States shown per batch**: queued, delivered, answered, no agent (session gone; offer resume or re-route).

## Model and effort per thread

- A cycler per thread picks who answers: Claude tiers (`haiku`, `sonnet`, `opus`, each with an effort `low` to `max`) and Pi models from the routing tiers in `model-routing.md`.
- **Default: same as the original agent.** Prompt caching is per model, so any other choice re-reads the agent's full context uncached. Choosing another model shows a one-line warning saying so. The person keeps the choice.
- A non-default choice for a Claude agent resumes or messages the same session with that model for one turn, where the engine allows it; otherwise it starts a fresh answerer with the thread, the diff and the session's plan attached, and the pane says it is fresh. *Builder to confirm which is possible.*
- Each reply records the model and effort that wrote it.

## The person's edits, and overrule

- An edit typed in a tab is a **proposed patch**. It goes to the agent like a comment. The person decided it lands only after the agent agrees.
- If the agent agrees, the patch lands (applied to the worktree) and the thread records it.
- If the agent claps back, the person can keep discussing, accept the agent's alternative, or **overrule**: the patch lands anyway.
- An overrule is recorded in the thread, and the commit the pane makes for the overruled change (see "Landing and committing patches") gets a trailer, for example `Overruled: agent warned "drops the error handling the caller relies on"`, so the warning stays in `git log` and `git blame`.

## Order of operations that keeps approval possible

Landing a patch changes the tree, and today `agent-review approve` then refuses a Pi run with `tree-changed` (the trap seen with run `edaf6b3a`). The pane runs things in this order:

1. Land agreed or overruled patches.
2. Re-snapshot the agent's change (a new end state for the Pi run's record, or a new snapshot for the session).
3. Approve.

*Builder's call how the re-snapshot is recorded for a Pi run; it must not let a stale snapshot be approved.*

## Approval

- Per agent: approving accepts the agent's files as they now stand. Files can be returned instead of accepted (the decision format already has per-file `accepted` and `changed`).
- **Pi runs and specs** keep their gates: approval goes through the existing macOS confirmation dialog (`agent-review approve`, `ac-run approve`). The pane never writes those approvals itself, and no agent can press them.
- **Claude sessions are review-only.** The person decided an unapproved session blocks nothing (no commit, push, PR or gate check reads it); it is only shown in the pane. Approving a session clears its unapproved set after a two-press confirm in the pane, with no macOS dialog. *Designer's call:* the session approval records are kept outside the repository (for example under `~/.local/state/`), so an agent editing the worktree cannot casually clear its own set; because nothing is gated, a forged record could only hide files from the pane, which is the accepted risk.

## Landing and committing patches

The person decided the **pane commits** every patch it lands (agreed or overruled), through `$HOME/dotfiles/scripts/commit-funnel`, which stages only the listed paths and refuses `main`, `master` and a foreign checkout. An overruled patch's commit carries the `Overruled:` trailer. The pane lands and commits only between the agent's turns (the same wait as delivery), so it never commits while that agent is mid-turn in the worktree.

## Two writers

A patch landing while another agent writes the same file would collide. Before landing, the pane checks that no live agent is mid-turn in that worktree on that file; if one is, the patch waits like a note. The `wt` lock and session-ownership manager in agent-harness (`feat/wt-lock-manager`) is the long-term owner of this check.

## Relationship to existing pieces

- `/gates` (`session-band-plugin/hooks/gates.tsx`) becomes the index: rows open the pane.
- `agent-review` (`scripts/agent-review`) keeps its pending, decision and approval flow; the pane writes decisions in its format (`files` with `accepted`/`changed`, `notes`, `patch`).
- `:AgentReview` in Neovim keeps working for anyone who prefers it.
- The Blast pane (PR #178) is unrelated except for shared drawing helpers.
- Highlighting uses the mod kit's `Code` element (`format: 'diff'` for hunks).

## Surface

Desktop app first, as the person asked; the terminal must also work, because session-band runs there today. *Builder to confirm mod panes render on the desktop surface before relying on it.* A pane draws about 100,000 characters, so large diffs are paged by hunk.

## Also shown in a tab

`floor-guard` findings for the agent's change, and pi-lens diagnostics where present, beside the diff.

## Notifications

When an agent answers, a toast names the file; the tab marks unread replies.

## Designer's calls after the builder check

These settle questions a builder would otherwise guess at. Each is the designer's call, not the person's, and can be overturned in review.

- **A Pi agent is its Pi session, not one run.** Resuming `pi --session-id pueue-<slug>` with a batch produces a new run with a new pending record whose base is the old end state. Threads and the unapproved set are keyed to the Pi session; its runs are chained. When a new run starts from a batch, the previous run's pending record is closed with a decision marked `superseded` (a new decision kind for `agent-review`) naming the new run id, so no stale record stays approvable or stuck.
- **The pane does not write `notes` or `patch` decisions.** Those make `agent-review approve` refuse (`already-decided`), and an exited `pi -p` run never reads them. Feedback travels only by the delivery above. The only decisions the pane causes are approval (through the dialog), `superseded`, and returned files at approval time.
- **A Claude session's diff base** is the snapshot at its last approval; before the first approval, the snapshot taken at session start. Commits the agent makes in between do not hide its changes.
- **Replies come back through a structured channel**, never parsed from free text. For a Claude session, a tool the mod registers (for example `review_reply`) that the agent calls with the batch id, the file, a verdict per proposed patch (`agree` or `clapback`), its text, and any alternative patch. For Pi, the same fields through a small Pi extension or a fixed JSON block the extension validates. An agreed patch is applied by the pane, mechanically, not by the agent.
- **A batch with no reply** moves from `delivered` to `no reply` after a timeout (builder's call on the length) and offers resend; it never looks answered.
- **Two agents in one worktree**: attribution is best effort. A file can appear in two agents' sets; its tab then says so and lists both. Approving one agent does not approve the other's changes to a shared file: a shared file is approved only when every agent that touched it is approved, or the person approves it explicitly for all. Exact attribution waits for the `wt` lock manager.
- **Returning a file of a Claude session** keeps it unapproved and queues a note to the session saying why; nothing is reverted.

## Left to the builder

Thread file format; how Bash touch detection stays fast; which engine mechanism delivers into a Claude session; how a Pi run's record is re-snapshotted; pane layout and keys within session-band's conventions.
