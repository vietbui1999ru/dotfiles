---
status: approved
branch: feat/focus
---
# SPEC: Focus slots for one person supervising many agents

## Objective
Keep at most one work and one hobby item open across all repos, make the current item visible in
every session, and stop agents from writing outside it. Success: a session started outside the
focus item's worktree cannot write files, the band always names the focus item, and the ~40
existing worktrees are triaged down to the caps.

Board: `~/repos/Obsidian/Focus.md` (overridable by `FOCUS_BOARD` for tests), sections `## Work`,
`## Hobby`, `## Frozen`, `## Parked`. Item key: `<repo>:<branch>`. Work = employer repos listed
in the board's `work-repos:` line; every other repo is hobby. Tool: `scripts/focus`.

## Acceptance Criteria
- AC-1: `focus triage` lists every worktree of every repo under ~/repos and ~/dotfiles with repo, branch, last commit date, dirty flag, PR state and SPEC.md presence
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_triage.py -k inventory`
- AC-2: `focus triage` changes no file, branch or worktree
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_triage.py -k read_only`
- AC-3: `focus status` exits non-zero and names the breach when Work or Hobby holds more than one item or Frozen holds more than three
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_board.py -k caps`
- AC-4: `focus switch`, `drop` and `park` update the board; switch freezes the old item and refuses at three frozen; drop removes a worktree only with `--yes` and never deletes a branch
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_board.py -k lifecycle`
- AC-5: the UserPromptSubmit hook prints both slots, their stage, and whether the session's start worktree is a focus item (else "read-only")
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_hooks.py -k prompt`
- AC-6: the PreToolUse guard denies Write, Edit and writing Bash outside a focus worktree when the session started outside one, allows Focus.md, Claude memory, job tmp and ~/.claude/plans, and its deny message names the focus item and how to switch
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_hooks.py -k guard`
- AC-7: `focus allow <worktree> --blocker "<reason>"` lets the current session write there until the session ends, and records the blocker under the focus item
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_hooks.py -k blocker`
- AC-8: `scripts/pi-view` refuses to start Pi in a worktree that is not a focus item, with the same message as the guard
  verify: `python3 -m unittest discover -s scripts/tests -p test_focus_hooks.py -k pi_dispatch`
- AC-9: the band shows the hobby and work slot, the stage, frozen count, and "read-only" when the session is outside a focus item
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) read-only appears when the session sits outside a focus item"`
- AC-10: the `/focus` pane shows each slot as a stage pipeline, lists frozen and parked items, and binds o, s, d and p
  verify: `claude plugin test session-band-plugin 2>&1 | rg -q "\(pass\) the pane binds o s d p as hotkeys"`
- AC-11: both hooks are registered in the stowed Claude settings
  verify: `rg -q "scripts/focus guard" claude/.claude/settings.json && rg -q "scripts/focus prompt" claude/.claude/settings.json`
- AC-12: the focus rules (caps, refuse-park-switch, blocker exception, NEXT names the focus item) are in the always-loaded tool-routing rules
  verify: `rg -q "^## Focus slots" shared/research-tool-routing.md`
- AC-13: existing session-band tests still pass
  verify: `claude plugin test session-band-plugin`
  baseline: pass
- AC-14: a live Claude session started in ~/repos/llm-wiki main is denied a write into a dotfiles worktree and is told the focus item
  verify: manual - needs a real interactive session after stow

## Boundaries
### Always
- Run triage and show its result to the person before any guard is registered
- Write PLAN.md beside this spec; implementation goes to Pi per plan-handoff
- Keep every board edit to the four sections; never reorder the person's parked lines
### Ask first
- Removing any worktree, even a merged clean one
- Changing commit-funnel, agent-review or the worktree guard
### Never
- Delete a branch
- Touch llm-wiki or any repo other than dotfiles in this item
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Board path: Obsidian root or a subfolder? Default: `~/repos/Obsidian/Focus.md`.
- Does the guard apply to the work slot's employer repos on this machine? Default: yes, same rules.
- Read-only Bash: how is "writing Bash" detected? Default: deny on redirects, `rm`, `mv`, `cp`, `git commit|push|worktree add`, editors; allow everything else.
- Origin header in the band prompt and Review pane grouping by worktree: Default: parked, not v1.
- Codex sessions: Default: guard via the same script once Codex hooks exist; not v1.
