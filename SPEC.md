---
status: draft
branch: feat/agent-review-global
---
# SPEC: agent-review lists pending reviews across repos (Track A of the Neovim review dashboard)

## Objective
One command lists every pending agent review in every repo that has had one, so the Neovim start screen (Track B, branch `feat/nvim-review-dashboard`, its own SPEC.md) can show what is waiting for approval. Success: with reviews pending in two different repos, `agent-review list --global --json` run from either repo, or from a directory outside any repo, lists both.

This is one of two specs meant to be built by parallel sessions. They share only the JSON contract below; Track B tests against a stub CLI and does not wait for this branch.

### Contract shared with Track B
`agent-review list --global --json` prints one JSON array on stdout and exits 0, also when there is nothing to list. Each element is exactly a `list --all --json` entry (`runId`, `owner`, `branch`, `name`, `startedAt`, `processing`, `error`, `landed`, `orphan`) plus `repo`: the absolute path of that repo's main worktree. Elements are ordered non-orphans first, then by `startedAt`, oldest first.

### Decisions
- D1: The registry is a plain-text file at `${XDG_STATE_HOME:-$HOME/.local/state}/agent-review/repos`, one absolute main-worktree path per line. Readers ignore duplicates, blank lines and paths that are no longer git repositories. Nothing rewrites or prunes it in this phase.
- D2: Pi's agent-review extension registers the repo whenever it writes a pending record (normal and snapshot-failed records). Registration failures are swallowed; they must never stop the pending record from being written.
- D3: `agent-review register` registers the current repo by hand. It backfills the seven repos that already have `.pi/agent-review` state.
- D4: `list --global` scans every registered repo plus the current repo (when run inside one) with the existing `scan(root, every=True)`, so worktree discovery, `landed` and `orphan` work exactly as in `list --all`.
- D5: Text output (`list --global` without `--json`) prefixes each `list --all` line with the repo's directory name.

## Acceptance Criteria
- AC-1: When Pi writes a pending record, the repo's main-worktree path is added to the registry once, including for a run in a linked worktree, and a second run in the same repo adds no duplicate line
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "pending record registers the repo once"`
- AC-2: A registry that cannot be written (for example, its parent path is a file) does not prevent the pending record from being written
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "registry failure keeps the pending record"`
- AC-3: `agent-review register` run in a linked worktree registers the main worktree, and running it twice leaves one line
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "register is idempotent and uses the main worktree"`
- AC-4: `list --global --json` run from repo A lists a review pending only in registered repo B, with `repo` set to B's main worktree and every `list --all` field present
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "list --global finds a review in another repo"`
- AC-5: `list --global --json` run outside any repo, with registered repos A and B each holding a review, lists both, non-orphans first and then oldest first
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "list --global outside a repo orders entries"`
- AC-6: Registered paths that are missing or no longer git repositories are skipped silently, and the command still exits 0 with one JSON line
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "stale registry lines are skipped"`
- AC-7: With no registry file, `list --global --json` inside a repo lists that repo's reviews; outside any repo it prints `[]`; both exit 0
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test agent-review.global.test.ts -t "no registry falls back to the current repo"`
- AC-8: Existing extension and CLI tests still pass
  verify: `cd pi/.pi/agent/extensions/agent-review && /Users/vietquocbui/.bun/bin/bun test`
  baseline: pass
- AC-9: The workflow doc documents the registry path, `register` and `list --global`, including the JSON contract
  verify: `rg -q "list --global" docs/workflows/agent-review.md && rg -q "agent-review/repos" docs/workflows/agent-review.md && rg -q "agent-review register" docs/workflows/agent-review.md`
- AC-10: Use-test: after `agent-review register` in each repo with review state, `agent-review list --global` from `~` shows the reviews pending in dotfiles worktrees and in at least one other repo
  verify: manual - live check against the real registry and repos

## Boundaries
### Always
- Tests point `XDG_STATE_HOME` at a temporary directory; never read or write the real registry from a test
- Keep `list --all`, `approve` and `skip` output and behaviour unchanged
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- Any registry format other than one path per line, or any automatic pruning or rewriting of it
- Changes to the decision or pending record formats
### Never
- Approve, skip or otherwise act on a review from `list --global`; it only reads
- Edit Neovim files; they belong to Track B
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Should `list --global` include orphans? Default: yes, as `list --all` does; Track B decides what to show.
- Should the registry live under `~/.pi` instead of XDG state? Default: XDG state, because it is machine state shared by Pi, the CLI and Neovim, not Pi config.
- Is a full scan fast enough for the dashboard? Default: yes. Each repo takes about 0.5 s and Track B runs the scan in the background; add caching only if the use-test shows a problem.
