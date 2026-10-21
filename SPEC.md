---
status: draft
branch: feat/agent-ref-guard
---
# SPEC: agent-ref-guard, a git-level check behind commit-funnel

## Objective
The Bash hook that blocks `git commit` in worktree sessions matches command text, so `bash -c`, `eval`, a script file or an unusual spelling gets past it, and Pi has no Bash hook at all. Move the check into git itself: a `reference-transaction` hook that refuses to move an existing branch in a `.claude/worktrees/` checkout unless commit-funnel asked for it. Git runs this hook for every ref update, so `--no-verify` does not skip it, and it also catches rebase, reset, cherry-pick, merge and `update-ref`.

Success: in a dotfiles agent worktree, any git command that moves an existing branch fails with a message pointing at commit-funnel, and commit-funnel still commits; the human's main checkout behaves exactly as before.

### Threat model
This stops agents that commit by habit or by accident, through any spelling. It does not stop a same-user process that deliberately sets the funnel's environment variable or deletes the hook; nothing a same-user agent can reach can. The worktree-isolation guard and the agent-review gate stay the controls for that.

### Decisions
- D1: Hook file `scripts/hooks/reference-transaction` (POSIX `sh`, tracked), linked into the dotfiles common hooks directory (`$(git rev-parse --git-common-dir)/hooks/reference-transaction`) by `scripts/bootstrap-dirs.sh`, the same way `post-commit` is installed (existing non-link file saved as `.bak`). Dotfiles repo only in this phase.
- D2: The hook acts only when its first argument is `prepared`; `committed` and `aborted` exit 0.
- D3: It acts only when `git rev-parse --show-toplevel` contains `/.claude/worktrees/`. Elsewhere it exits 0 without reading stdin further.
- D4: Inside such a worktree it reads `<old> <new> <ref>` lines and refuses (exit 1) when any line has `<ref>` under `refs/heads/` and `<old>` is not all zeros, unless the environment has `COMMIT_FUNNEL=1`. That refuses moving or deleting an existing branch, and allows creating a new branch (`<old>` all zeros). Lines for `HEAD`, `refs/remotes/*`, tags and other refs are always allowed.
- D5: The refusal message (stderr) names the ref, says this worktree belongs to an agent session, gives the commit-funnel usage, and says that rebase, reset, merge and branch deletion are the user's call: ask the user to run them.
- D6: `scripts/commit-funnel` sets `COMMIT_FUNNEL=1` only in the environment of its own `git commit` call (git mode). jj mode needs no change: jj writes refs through its own library and git runs no hooks for it, so jj bookmark moves are not covered (known gap, see Open Questions).
- D7: `claude/.claude/hooks/enforce-bash-safety.sh` additionally blocks, inside `.claude/worktrees/` cwds, any command containing `COMMIT_FUNNEL=` or `core.hooksPath`, so a Claude session does not learn to forge the variable or point git away from the hook.
- D8: A human override for the human's own work inside an agent worktree: `AGENT_REF_GUARD=off` makes the hook exit 0. The Bash hook blocks commands containing `AGENT_REF_GUARD=` in worktree cwds, like D7.

## Acceptance Criteria
- AC-1: In a temp repo with a linked worktree under `<tmp>/.claude/worktrees/w` and the hook installed in the common hooks dir, a plain `git commit` in that worktree fails, leaves the branch where it was, and prints a message naming `commit-funnel`
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_plain_commit_refused`
- AC-2: The same refusal happens for `git commit --no-verify`, `bash -c 'git commit -m x'`, `git reset --soft HEAD~1`, `git update-ref refs/heads/<branch> <sha>` and `git branch -D <other>` in that worktree
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_other_branch_moves_refused`
- AC-3: In that worktree, `git switch -c new`, `git tag t`, `git fetch` from a local remote and `git status` succeed
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_non_branch_moves_allowed`
- AC-4: `COMMIT_FUNNEL=1 git commit` in that worktree succeeds, and `scripts/commit-funnel` commits there in git mode
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_funnel_commit_allowed`
- AC-5: In the main checkout of the same temp repo (not under `.claude/worktrees/`), plain `git commit`, `git reset --soft HEAD~1` and `git branch -D <other>` succeed
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_main_checkout_unaffected`
- AC-6: `AGENT_REF_GUARD=off git commit` in the worktree succeeds
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_human_override`
- AC-7: `scripts/bootstrap-dirs.sh`'s hook-linking step, run against a temp repo, links `reference-transaction` next to `post-commit`, saves an existing non-link `reference-transaction` as `.bak`, and is idempotent
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_bootstrap_links_hook`
- AC-8: The Bash safety hook blocks commands containing `COMMIT_FUNNEL=`, `AGENT_REF_GUARD=` or `core.hooksPath` with exit 2 when `cwd` is under `.claude/worktrees/`, and allows them elsewhere
  verify: `cd scripts/tests && python3 -m unittest test_agent_ref_guard -k test_bash_hook_blocks_forged_env`
- AC-9: Existing script tests still pass
  verify: `cd scripts/tests && python3 -m unittest test_commit_funnel test_spec_loop test_post_commit_hook`
  baseline: pass
- AC-10: `docs/workflows/worktree-guard-bandaid.md` documents the git-level hook, its threat model, the human override and the jj gap
  verify: `rg -q "reference-transaction" docs/workflows/worktree-guard-bandaid.md && rg -q "AGENT_REF_GUARD" docs/workflows/worktree-guard-bandaid.md`
- AC-11: Use-test: after merging and running `scripts/bootstrap-dirs.sh`, a Pi run and a Claude session in dotfiles worktrees both fail on a plain `git commit` and succeed through commit-funnel; a commit in the main `~/dotfiles` checkout still works
  verify: manual - needs the live repo, a Pi run and a Claude session

## Boundaries
### Always
- Tests build throwaway repos (with a real linked worktree under a `.claude/worktrees/` path) in a temp dir, with a temp `HOME` and `GIT_CONFIG_NOSYSTEM=1`; never install the hook into the real repo from a test
- Keep `post-commit` installation and every existing Bash-hook block unchanged
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done, then archive SPEC.md per spec-loop rule 7
### Ask first
- Installing the hook into any repo other than dotfiles (llm-wiki, other repos)
- Using `core.hooksPath` or any global git config
- Covering jj bookmark moves (needs a different mechanism)
- Refusing anything beyond existing `refs/heads/*` updates and deletions
### Never
- Change the funnel's refusal rules or its jj mode
- Run the real `scripts/bootstrap-dirs.sh` against `~/dotfiles` from an agent session; the human runs it after merge
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- jj bookmark moves bypass git hooks entirely. Default: accept the gap; the Bash hook still blocks `jj commit`/`jj ci` for Claude, and Pi's rules say to use the funnel. A jj-native check would need jj's own hook support, which jj 0.46 does not offer.
- Pi runs in `.claude/worktrees/` will start failing on plain `git commit`. Default: intended; `shared/AGENTS.md` already tells Pi to use the funnel, and AC-11 checks a real Pi run. If Pi plans keep tripping it, add the funnel line to the delegate-pi plan template.
- Should agents be allowed to delete their own branches? Default: no; branch deletion is already an "ask first" operation.
