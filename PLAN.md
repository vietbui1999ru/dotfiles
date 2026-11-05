# PLAN: Focus slots (feat/focus)

Implements the approved `SPEC.md` on `feat/focus`. Work only toward its AC ids; obey its Boundaries.
Never edit a `verify:` line. Commit after each step through `$HOME/dotfiles/scripts/commit-funnel`.

## Context
One person supervises ~40 worktrees across repos. The spec caps open work at one work item and one
hobby item, shows the focus item in every session, and blocks writes outside it. This plan is the
handoff to Pi. It is split into two dispatches because the spec requires the person to see
`focus triage` output before any guard is registered (Boundary: Always).

## Shared contract (decided here; record in SPEC.md `## Assumptions` if you deviate)

Board file (`FOCUS_BOARD`, default `~/repos/Obsidian/Focus.md`):

```
work-repos: acme-api, acme-web

## Work
- acme-api:feat/x | stage: build

## Hobby
- dotfiles:feat/focus | stage: build
  - blocker 2026-11-05 llm-wiki@main: <reason>

## Frozen
- dotfiles:feat/old | stage: review

## Parked
- any free text the person wrote; never reorder or rewrite these lines
```

- Stages, in pipeline order: `spec`, `plan`, `build`, `review`, `merge`.
- Item key `<repo>:<branch>`. Repo name to path: `dotfiles` is `$HOME/dotfiles`, otherwise
  `$HOME/repos/<repo>`. Override the roots with `FOCUS_ROOTS` (colon-separated dirs that hold repos,
  plus `$HOME/dotfiles` itself) for tests.
- Item worktree: the path from `git -C <repo> worktree list --porcelain` whose branch matches.
- A repo is work if it is listed on `work-repos:`. Otherwise it is hobby.
- A missing board means focus is not configured. In that state the guard, prompt and pi-view allow
  everything and print one line, `focus: no board`. This keeps bootstrap and other machines working.
- State dir: `FOCUS_STATE` (default `$HOME/.claude/state/focus`). It holds `sessions.json` as
  `{session_id: {start_cwd, grants: [paths]}}`.
- Session start worktree: the first `prompt` or `guard` call for a `session_id` records `cwd` as
  `start_cwd`, and later calls never overwrite it. UserPromptSubmit fires before any tool, so it
  gets the real start. No extra SessionStart hook is needed.

## Dispatch 1: everything except hook registration (AC-1..10, 12, 13)

### Step 1: `scripts/focus` core and board (AC-3, AC-4)
- New file `scripts/focus`: Python 3, stdlib only, `argparse` with `main(argv=None)`. Follow the
  `scripts/safety-log` pattern (`:241-308`).
- Board parser and writer. A round-trip must leave the bytes unchanged. Edits touch only the four
  sections, and Parked lines keep their order and text.
- `status [--json] [--cwd P]`: prints the slots, stages, frozen count and whether `--cwd` is inside
  a focus worktree. It exits 1 and names each breach (for example `breach: Work holds 2 items`) when
  Work or Hobby holds more than one item or Frozen holds more than three. The `--json` output is
  `{work:{key,stage}|null, hobby:…, frozen:[…], parked:[…], read_only:bool, breaches:[…]}`. That is
  the band's contract.
- `switch <key> [--stage S]`: moves the slot's current item to Frozen, then puts `<key>` into the
  slot (work or hobby, chosen by its repo). If `<key>` was in Frozen or Parked, take it out of
  there. It refuses with exit 1 if Frozen already holds 3 items.
- `drop <key> [--yes]`: removes the item from the board. With `--yes` it also runs
  `git worktree remove` on the item's worktree. It never runs `git branch -d/-D`.
- `park <key>`: moves the item to the end of Parked.
- `stage <key> <S>`: sets the stage. This is needed for the pipeline display and costs little.
- Tests: `scripts/tests/test_focus_board.py`. Name the test methods `test_caps_*` and
  `test_lifecycle_*` so the spec's `-k caps` and `-k lifecycle` select them. Use a temp
  `FOCUS_BOARD` and a temp git repo with one worktree for drop. Assert the branch still exists after
  `drop --yes`.

### Step 2: `focus triage` (AC-1, AC-2)
- For each git repo directly under the `FOCUS_ROOTS` dirs, plus dotfiles, run
  `git worktree list --porcelain`. For each worktree, show repo, branch, the last commit date
  (`git log -1 --format=%cs`), a dirty flag (`git status --porcelain` non-empty), PR state and
  whether SPEC.md exists.
- PR state needs one `gh pr list --state all --limit 300 --json headRefName,state` call per repo,
  mapped by branch. A gh failure gives `?`. Reuse the error mapping idea from
  `session-band-plugin/hooks/draft-prs.ts` (`readGh`).
- Output: an aligned table, plus `--json`. It must not write anything: no `git fetch`, no index
  refresh (`git status` with `--no-optional-locks`), and no state file.
- Tests: `scripts/tests/test_focus_triage.py` with `test_inventory_*` and `test_read_only_*`. Put a
  fake `gh` on PATH. The read-only test snapshots every file's mtime and content hash, plus
  `git for-each-ref` and the worktree list, before and after, and asserts they are equal.

### Step 3: hooks: `focus prompt`, `focus guard`, `focus allow` (AC-5, AC-6, AC-7)
- Both hooks read the hook JSON from stdin (`session_id`, `cwd`, `tool_name`, `tool_input`). See the
  stdin parsing in `claude/.claude/hooks/enforce-bash-safety.sh:7-9`.
- `prompt` (UserPromptSubmit): records start_cwd, then prints e.g.
  `focus: work acme-api:feat/x [build] | hobby dotfiles:feat/focus [build] | this session: focus`
  or `... | this session: read-only`. It always exits 0.
- `guard` (PreToolUse). The session is writable if its `start_cwd` is inside a focus worktree.
  Otherwise, decide by tool:
  - `Write|Edit|MultiEdit|NotebookEdit`: deny unless the target is inside a focus worktree, or a
    session grant, or the allowlist.
  - `Bash`: deny when the command writes. That means a redirect `>`/`>>` to a path that is not
    `/dev/null`, `tee`, `rm`, `mv`, `cp`, `mkdir`, `touch`, `sed -i`, `git commit|push|worktree
    add|checkout|switch|reset|merge|rebase`, `jj` writes, or the editors `vim nvim nano`. Allow
    everything else, and allow a command whose only write targets are allowlisted.
  - Allowlist: the board file, `~/.claude/projects/*/memory/**`, `~/.claude/jobs/*/tmp/**`,
    `$CLAUDE_JOB_DIR/tmp/**` and `~/.claude/plans/**`.
  - Deny output: the PreToolUse JSON `{"hookSpecificOutput":{"hookEventName":"PreToolUse",
    "permissionDecision":"deny","permissionDecisionReason":MSG}}`.
  - MSG, one shared function used by pi-view too: `focus: read-only session. Focus items: <work>,
    <hobby>. Switch: scripts/focus switch <key>. Unblock once: scripts/focus allow <worktree>
    --session <sid> --blocker "<reason>"`.
- `allow <worktree> --session <sid> --blocker "<reason>"`: adds the path to that session's grants
  in `sessions.json` and appends `  - blocker <date> <repo>@<branch>: <reason>` under the focus
  item that matches the session's start repo. If that repo has no item, append under the hobby
  item. The grant lasts as long as the session id, which is how "until the session ends" is met.
- Tests: `scripts/tests/test_focus_hooks.py` with `test_prompt_*`, `test_guard_*` and
  `test_blocker_*`. Feed JSON over stdin. Cover the allowlist paths and the deny message contents.

### Step 4: pi-view refusal (AC-8)
- In `scripts/pi-view`, after argument parsing (`:45-46`) and before the secrets load (`:54`), run
  `"$HOME/dotfiles/scripts/focus" check-dispatch --cwd "$PWD"`. Resolve the script relative to
  `${0:A:h}` so the tests use the branch copy. On a non-zero exit, print its stderr (the shared
  MSG) and exit 1 without writing a provenance row.
- `check-dispatch` exits 0 when there is no board or `$PWD` is inside a focus worktree, and 1
  otherwise.
- Test `test_pi_dispatch_*` in `test_focus_hooks.py`. Follow `scripts/tests/test_pi_view_provenance.py`
  (subprocess, wholesale env, temp HOME). Assert the exit code, the message, and that no ledger row
  was written.

### Step 5: session-band band segment (AC-9)
- `session-band-plugin/hooks/focus.ts` is pure. `FOCUS_ARGV(cwd)` gives
  `[$HOME/dotfiles/scripts/focus, status, --json, --cwd, cwd]`, and `parseFocus(json)` and
  `focusChip(state)` return e.g. `H dotfiles:feat/focus·build W acme-api:feat/x·plan ❄2` plus
  ` read-only` when `read_only` is true. With no board, it returns no chip.
- Wire it into `band-text.ts` and `band.tsx` next to the `DRAFT_PRS` chip (`band.tsx:34`). Refresh it
  in `register.tsx` where `refreshGit` runs, using `$.process.run`. Give it a drop rank in
  `fitStatus` (`band-text.ts:47-54`) below the git chips. The focus item must survive the narrowest
  layout, and only the frozen count may drop.
- Test `session-band-plugin/hooks/focus.test.ts`: pure string asserts plus one engine test that
  stubs `on('process.run')`, following `band-text.test.ts` and `draft-prs.test.ts`.

### Step 6: `/focus` pane (AC-10)
- `session-band-plugin/hooks/focus.tsx` copies the `draft-prs.tsx` pattern: register the command,
  then `on('command.run', {command:'focus'})` calls `$.ui.open`, and `on('ui.render', {component:'Pane',
  requestId:'focus'})` renders.
- Render each slot as a pipeline `spec › plan › [build] › review › merge`, then the frozen and
  parked lists. `j`/`k` select a frozen or parked row.
- Hotkeys: `o` runs `open "obsidian://open?path=<board>"`; `s` runs `focus switch <selected>`;
  `d` runs `focus drop <selected>` (never `--yes` from the pane); `p` runs `focus park <selected>`.
  Re-read the status after each action.
- Test `session-band-plugin/hooks/focus-pane.test.ts`: use the `lines()` helper pattern from
  `gates-pane.test.ts`. Assert the pipeline text, both lists, and that each of `o s d p` is a
  Button hotkey that issues the expected argv.

### Step 7: rules (AC-12)
- Add `## Focus slots` to `shared/research-tool-routing.md`, after `## Spec loop`. It covers:
  - the caps: one work, one hobby, at most three frozen;
  - refuse, park or switch: when asked for work outside the focus item, say so and offer
    `focus park` or `focus switch`, never just start;
  - the blocker exception: use `focus allow … --blocker` only when the focus item is blocked by
    the other worktree;
  - every `NEXT:` line names the focus item.
- `claude/.claude/rules/tool-routing.md` symlinks to that file, so there is no second copy.

### Dispatch 1 done when
All verify lines for AC-1..10, 12 and 13 pass (`~/dotfiles/scripts/spec check SPEC.md`; AC-11 and
AC-14 are expected to fail or stay manual). `scripts/floor-guard` is clean. Do not touch
`claude/.claude/settings.json`.

## Gate (Claude and the person, between dispatches)
1. Review Dispatch 1's commits with `:AgentReview`.
2. Run `scripts/focus triage` from the worktree and show the table to the person. They triage
   toward the caps, and every worktree removal needs their yes (Ask first).
3. The person creates the board at `~/repos/Obsidian/Focus.md`, with `focus switch
   dotfiles:feat/focus --stage build` as the first entry.

## Dispatch 2: registration (AC-11)
- In `claude/.claude/settings.json`, add a PreToolUse entry with matcher
  `Write|Edit|MultiEdit|NotebookEdit|Bash` → `$HOME/dotfiles/scripts/focus guard` (timeout 5), and
  a UserPromptSubmit entry → `$HOME/dotfiles/scripts/focus prompt` (timeout 5). Add both entries;
  change none of the existing ones.
- Then `spec check` passes for everything except AC-14. AC-14 is the person's live test after merge
  and stow.

## Out of scope (spec Never / not v1)
llm-wiki and every other repo; branch deletion; commit-funnel, agent-review and the built-in
worktree guard; Codex hooks; the origin header and the Review pane grouping.


## Dispatch 1b: finish Dispatch 1 and fix triage findings
Dispatch 1 stopped after Step 5. Do Steps 6 and 7 as written above, then these fixes. Each fix
gets a test in the existing test file it touches.

### Fix A: parse the person's free-form item lines (AC-3, AC-5)
The live board writes items as `- dotfiles:feat/focus: focus slots, guards, ...` with no `| stage:`.
Today that parses as an empty slot, so the slot owner's own session is read-only.
- Item key: the first `<repo>:<branch>` token after `- `. Git refnames cannot contain `:`, so the
  key ends at the second `:` or at whitespace or `|`. The rest of the line is a free-text note.
- If there is no `| stage:`, the stage is unknown. Show it as `?`, and the pane highlights no stage.
- Writes keep the note text byte-for-byte. `switch` and `stage` add or replace only the `| stage: S`
  part.
- Test `test_caps_freeform_line_counts` and `test_lifecycle_freeform_note_kept`.

### Fix B: one row per worktree in triage, and find nested repos (AC-1)
- Linked worktrees sit as sibling directories under `~/repos` (`llm-wiki-lean-kit` was one), so
  triage listed the same worktrees again under each sibling. Group repos by
  `git rev-parse --path-format=absolute --git-common-dir`, and name each repo after its main
  worktree's directory.
- Repos nest: the work repo is `~/repos/WORK/ACME/Work IG/personal-ai-gateway`, and its path has a
  space. Scan the `FOCUS_ROOTS` dirs recursively to depth 4. Do not descend into a git repo, or into
  `.claude/worktrees`, `node_modules` or hidden dirs. Quote every path.
- Repo name to path (the shared contract) uses the same scan. When two repos share a name, it is an
  error.
- Test `test_inventory_dedupes_linked_worktrees` and `test_inventory_nested_repo_with_space`.

### Done when
The same as Dispatch 1. In addition, `scripts/focus status --json --cwd <this worktree>` against the
fixture board copied from the live format reports `read_only: false`.
