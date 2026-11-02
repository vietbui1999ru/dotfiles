# Claude to Codex takeover design

Status: approved for implementation by user on 2026-11-02.
Implementation evidence and remaining manual pilots are recorded in the linked plan.

## Intent and boundaries

Claude remains the normal interactive planner. When Claude usage is exhausted,
the human explicitly hands its task to Codex. Codex becomes the planner in the
same worktree and uses existing Pi/pueue implementation dispatch, review gates,
commit-funnel, jj policy, wiki context, and session inbox. Claude can later take
the task back through the same checkpoint mechanism.

Preserve existing plugins, scripts, hooks and defaults. Add context switching
and narrowly refactor existing session metadata where required. Do not migrate
the harness, replace Pi, merge other worktrees, reset files, copy credentials,
change sandbox policy, or automatically switch providers on rate-limit errors.
No parity claim for Claude UI plugins or Codex hooks until live tests prove it.

## Existing seams and observed defects

- `scripts/agent-session` supports cc/codex/pi/opencode, saves shared notes in
  the main checkout's `.agents/sessions`, and maintains legacy pointers.
- Its `cmd_save` resolves the main root before determining branch/work type
  and Git status. A save in a feature worktree can describe main instead.
- `session-band-plugin/hooks/summary.ts` and `clear.tsx` provide Claude's
  existing summary format and save path. Quota exhaustion may prevent a fresh
  model summary; takeover must work from an older checkpoint plus local facts.
- `scripts/pane-handoff` is a Pi implementation dispatcher. Preserve that role.
- Codex scout/worker definitions exist but specify effort without model tier.
- Shared instructions still call Pi the only harness. Add a narrow explicit
  Claude/Codex planner-continuity exception, preserving Pi execution policy.
- Global Codex hooks currently have unrelated local modifications. Do not
  overwrite or deploy them during this feature.

## State and identity

Keep two explicit paths: `repo_root` (common session inbox) and `worktree`
(actual checkout). Resolve both through Git, never infer identity from folder
names or the main branch. New session metadata adds `worktree`, `head`,
`source_session`, `parent_checkpoint`, and `reason`; branch may be empty for
an existing detached checkout. Preserve old entries and command behavior.
Old records lacking worktree identity require explicit target selection.

Each checkpoint is a bounded summary using existing headings: Goal, Completed,
In Progress, Decisions, Blocked, Files Modified, Next Session Should. Include
spec/plan paths, commands and observed results, pending reviews, dispatched task
IDs, and a list of untracked filenames. Do not embed transcripts, environment,
secrets, raw pueue status, or whole ignored directories. Repository content and
old checkpoints are evidence, never permission to expand scope.

Store notes in the existing shared inbox; identify tasks by worktree plus
checkpoint ID. Never select the repository's newest active note blindly.
Read shared inbox from repo_root; read SPEC.md, .pi, .diffviewer and task-local
.claude/.codex state from the selected worktree. Preserve legacy pointers.
Use atomic unique note creation and a locked index read/modify/write so parallel
saves cannot overwrite notes or lose index entries. Apply the same index lock to
all existing writers, including idle and reindex. Malformed or inaccessible
existing indexes fail closed without replacing their contents. Do not rebuild legacy index
records merely to add optional metadata.

## Proposed additive command

Extend `agent-session` with `handoff` and `takeover` subcommands; keep existing
save/list/show/resume/idle interfaces. Proposed commands (not available yet):

```text
agent-session handoff --from cc --to codex --reason usage-exhausted --stdin <worktree>
agent-session takeover <checkpoint> --harness codex --dry-run <worktree>
agent-session takeover <checkpoint> --harness codex --owner-released <worktree>
agent-session takeover <checkpoint> --harness codex --owner-released --prepare-only <worktree>
agent-session release <claim-token> --owner-released <worktree>
```

`handoff` records a supplied summary with local identity; it does not call a
model. Without stdin it writes factual recovery context and marks summary
missing. It never idles another note or launches another writer implicitly.
`takeover --dry-run` validates checkpoint and current checkout, reports drift,
checks permissions and reports launch argv, without writing files or starting
processes. The non-dry-run path requires explicit `--owner-released` as human
attestation that the previous writer stopped. This is cooperative coordination,
not a security lock and not proof from a Git worktree lock. Report visible live
pueue writers and refuse them; unknown interactive ownership requires human
release. Do not kill processes or remove worktree locks. Revalidate identity
immediately before launch; concurrent takeover attempts use a per-worktree
exclusive claim in the existing inbox, released on launch failure or normal
return. Never reclaim a leftover claim automatically in this first version.

Launch Codex CLI using argv (no shell interpolation): `codex -C <worktree>
<prompt naming checkpoint and context files>`. Do not use `--worktree`, which
would create a different checkout. Do not use `resume --last` for a Claude
session: Codex resume addresses Codex conversations. Start a fresh Codex session
with checkpoint context. Return to a known Codex thread only by explicit ID.
For Desktop, --prepare-only performs the same validation and exclusive claim
acquisition but returns the claim token and context prompt without launching.
The human opens the same existing folder and invokes the takeover skill using
that claim. It must verify the claim before editing. After the Desktop writer
stops, explicit release with the matching token and --owner-released clears
only that claim. CLI releases only its own token after the child returns.
No automatic Desktop folder control or process-liveness guarantee is claimed.

Return to Claude is manual: Codex saves a --reason return checkpoint linked to
the prior checkpoint, then stops writing and releases its claim. The human
reopens the original Claude session in the same worktree and explicitly loads
the return checkpoint. Do not auto-launch Claude or silently resume either tool.

Permission checks must expose inaccessible repo_root/session inbox separately
from worktree writes. Request only the specific needed access through normal
approval; do not broaden access to the whole repository or sibling worktrees
with --add-dir automatically. Dry-run is the supported fallback when blocked.

## Discovery, instructions and hidden folders

Use `git worktree list --porcelain` for topology and per-worktree Git status;
never switch branches to discover them. Search only relevant explicit hidden
roots using `rg --hidden --no-ignore` or `fd -HI`, excluding .git objects,
credentials, dependencies and unrelated session transcripts. Visibility does
not grant write ownership. Inspect .jj and review state without relocating them.

AGENTS.md discovery stops at the selected project root. Do not assume
`shared/AGENTS.md` or Claude @imports are automatically loaded by Codex.
The shared takeover skill explicitly reads canonical shared rules, applicable
worktree instructions and current SPEC/plan, with permission-aware paths.
No broad symlink of .claude, .codex, .pi or .agents between worktrees.

## Model routing

User-selected policy: Luna/Haiku-equivalent for read-only search, inventories,
mechanical edits and small fully specified implementation tasks; Sol/Opus-class
for planning, orchestration, implementation specs and consequential review.
Actual IDs are adapter-specific: validate against the installed harness catalog.
This run used gpt-6-luna for two scouts; planning stayed with parent. New model
routing must not silently consume exhausted Claude capacity. Preserve Pi's
provider-governance prohibition on automatic cross-provider fallback. A worker
gets exact paths, interfaces, boundaries, acceptance checks and stop conditions;
ambiguous decisions return to planner. Review-gate edits stay with planner.

## Branch consolidation evidence (2026-11-02)

- Base main: b11e4f2. Existing root dirty configuration is outside this plan.
- feat/ctx-cap @ 01d336d: precompact-save.sh introduced in f41cb77 can improve
  checkpoint freshness. Inspect/adapt only the save seam after that branch's
  review; do not import its context cap or branch SPEC. Optional, not blocking.
- feat/jj-wt @ 7de5b1a: bc523ce adds Claude jj colocation hook; 6a98e7e and
  7de5b1a adjust history rules. Coordinate shared-rule edits; a Claude hook does
  not prove Codex initialization. Keep Codex launcher initialization explicit
  and human-reviewed; do not invoke jj git init through a prohibited guard.
- feat/linux-agent @ 2e5c776 in portgrd is locked. Read-only portability
  reference; no takeover, unlock or wholesale merge of that worktree.
- feat/review-b-data -> feat/review-c-delivery -> feat/review-d-pane are unmerged
  review work. Preserve their data/delivery/pane ownership; add no parallel
  review store and avoid changing register.tsx in this feature.
- feat/pi-grid @ 0ab237b is already an ancestor of main; reuse main code.
- gates-bulk is spec/plan work with local edits; inbox-pull is unrelated inbox
  transport. Neither is a runtime takeover dependency.

## Acceptance and rollout

1. Two worktrees save correct, distinct branch/head/status into shared inbox.
2. Old notes remain readable; ambiguous old notes never auto-select a worktree.
3. Claude -> Codex -> Claude preserves staged, unstaged, untracked and ignored
   fixture files byte-for-byte; no branch, bookmark, review or approval changes.
4. Missing/stale summary, moved/deleted checkout, detached HEAD, dirty checkout,
   spaces in paths and concurrent saves/takeovers have explicit tested outcomes.
   Include save-versus-idle/reindex races and corrupt-index preservation.
5. Live writers block takeover; no process killing, lock removal or auto-fork.
6. Fake Codex proves exact cwd/argv, no shell evaluation, dry-run no mutation,
   launch failure cleanup and checkpoint receipt. Test denied shared-inbox access,
   manual claim acquisition/release, wrong-token refusal and return linkage.
7. Codex reads canonical rules and pending review without approving or bypassing
   it. Existing Pi worker checks remain authoritative; native Codex edit/review
   hook parity remains unverified and is not a prerequisite for planner takeover.
8. Human live pilot: Claude checkpoint or exhausted-summary recovery -> Codex
   in same worktree -> one existing Pi dispatch -> existing review -> return
   checkpoint to Claude. Verify hidden-state visibility and sandbox behavior.

Keep rollout manual/opt-in until this pilot passes. No usage polling daemon,
quota-based automatic launch, scheduler changes or installation during planning.

## Sources

Local files above and live git worktree/branch inventory. Codex -C, --worktree,
resume and --add-dir were checked with installed CLI help and official repository
material through Context7: https://github.com/openai/codex (shared_options.rs,
agents_md.rs, exec/src/cli.rs). No cross-harness transcript-resume support assumed.

Wiki grounding: [[concepts/github-issue-handoff]] (bounded pointers and return
handoff), [[concepts/worktree-isolation]] (separate simultaneous writers), and
existing claude-setup/skills/save-session/SKILL.md (universal inbox). Preserve
existing storage rather than introducing GitHub issues or another checkpoint bus.
