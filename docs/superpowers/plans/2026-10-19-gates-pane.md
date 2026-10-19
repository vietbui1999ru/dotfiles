# Gates Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/gates` pane in the session-band mod lists every worktree's specs and pending Pi reviews and lets the person approve, reject or edit them. `ac-run approve` asks through a macOS dialog instead of reading stdin.

**Architecture:** `scripts/ac-run` gains a dialog `confirm()` (modelled on `scripts/agent-review` `confirm()`) and a read-only `show` subcommand. The plugin gets pure logic in `session-band-plugin/hooks/gates.ts` (discovery, status parsing, argv builders, row model) and a pane in `gates.tsx` that runs the processes and draws. `$` cannot cross an import, so `gates.tsx` makes its own process calls and imports only pure helpers.

**Tech Stack:** Python 3 (stdlib, unittest), TypeScript Claude Code plugin (`claude-code` engine, `claude-code/testing` kit).

**Spec:** `docs/superpowers/specs/2026-10-19-gates-pane-design.md` (approved 2026-10-19). Read it first; this plan argues from it.

## Preconditions

- PR #128 (`fix/pi-pane-layout`) must be merged into `main` first. This plan uses its `switchSteps`, `PANE_TITLES` and per-pane `goTo`/`cycle` runner in `session-band-plugin/hooks/pane-nav.ts`. Branch `feat/gates-pane` from `origin/main` after that merge. Do not stack on `fix/pi-pane-layout`: merging a child PR after its base was squash-merged lands it on a dead branch.

## Global Constraints

- Never run `ac-run approve` or `agent-review approve` against a real spec or run, and never run `ac-run approve` in a way that shows the real dialog. Tests must replace `confirm` in-process.
- Never edit any existing spec's `verify:` or `baseline:` line. Do not edit `SPEC.md` or `specs/*.md`.
- No skip path for the dialog: no environment variable, flag, config file, stdin answer, PATH stub or committed helper script that approves without the dialog. The only test seam is in-process replacement of `confirm` inside `unittest`.
- The dialog runs `/usr/bin/osascript` by absolute path, with buttons `{"Cancel", "Approve"}`, `default button "Cancel"` and `cancel button "Cancel"`. Only the reply `Approve` approves. An osascript failure or a timeout means not approved, and there is no terminal fallback.
- The pane always invokes `${HOME}/dotfiles/scripts/ac-run` and `${HOME}/dotfiles/scripts/agent-review`.
- Spec discovery: worktree-root `SPEC.md` and `specs/*.md`, each only when its front-matter `branch:` equals the worktree's current branch. Detached worktrees list no specs.
- Spec state from `ac-run status`: exit 0 → `approved`; exit 3 → `stale` if stdout starts with `stale`, else `draft`; any other exit → `invalid` with the first non-empty stderr line.
- Every key the pane uses is a Button `hotkey` (unbound keys fall through to the composer). Key bar idiom: `flexDirection="row" flexWrap="wrap" columnGap={2} marginBottom={1}`.
- Plugin tests: `cd session-band-plugin && claude plugin test .`. Python tests: `python3 -m unittest scripts/tests/test_spec_loop.py`.
- Commit after each task; stage by path.

## Review Focus

1. A worktree path containing spaces. Expect Edit to open the right file, and every process call to get its cwd as one argv element, not shell-split. Test in Task 3 (`editRemoteArgv` escaping).
2. Two worktrees whose specs share a repo-relative path (both have `SPEC.md`). Expect two rows keyed by absolute path, so actions never hit the wrong worktree. Test in Task 2.
3. Approve pressed twice quickly. Expect a single `ac-run approve` process. Test in Task 4.
4. A main checkout whose `SPEC.md` names another branch (the real state of `main` today). Expect no row and no error. Test in Task 2.
5. A pending review JSON that is malformed or half-written. Expect it skipped, not a crash; `parsePending` returns undefined. Test in Task 5.

---

### Task 1: `ac-run` dialog confirm and `show`

**Files:**
- Modify: `scripts/ac-run` (`cmd_approve` ~:191, `HUMAN` :23, `main` :364)
- Modify: `scripts/tests/test_spec_loop.py` (`HUMAN` :21, `Fixture.approve` :133, `test_approve_refused` :351)

**Interfaces:**
- Produces: `confirm(spec: dict, runnable: list) -> bool` in `scripts/ac-run`; the subcommand `ac-run show SPEC_PATH`, which prints exactly the summary block `approve` prints (spec line, each AC, the "Approving records…" paragraph) and exits 0, or 2 on a usage error. It runs nothing and writes nothing.

- [ ] **Step 1: Replace the test helper's stdin approval with in-process approval.** In `Fixture`, add `approve_inproc(self, answer: bool, *opts) -> SimpleNamespace(returncode, stdout, stderr)`. It loads `ACRUN` with `importlib.machinery.SourceFileLoader("acrun_under_test", str(ACRUN))` and sets `module.confirm = lambda spec, runnable: answer`. Then, inside a context that temporarily sets `os.environ` to `self.env`, `os.chdir(self.repo)` and `sys.argv = ["ac-run", "approve", *opts, "SPEC.md"]`, it runs `module.main()` with `contextlib.redirect_stdout` and `redirect_stderr`, and restores all of it afterwards. Load the module inside the env context, because `STATE` reads `HOME` at import. Point `Fixture.approve(answer="y\n", …)` at it with `answer.strip().lower() == "y"`, so the existing call sites keep working unchanged.
- [ ] **Step 2: Add the failing tests.**
  - `test_approve_ignores_stdin`: the in-process approve with `confirm` returning False and `sys.stdin` replaced by `io.StringIO("y\n")`. Assert returncode 1, `"not approved"` in the output, `self.records() == []`, and that `SPEC.md` still says `status: draft`.
  - `test_confirm_failure_is_refusal`: `module.subprocess.run` replaced by a function that raises `OSError`. Assert `module.confirm(spec, runnable)` is False.
  - `test_confirm_needs_approve_reply`: a fake `subprocess.run` returning `CompletedProcess(args, 0, stdout="Cancel\n")`, then `stdout="Approve\n"`. Assert False, then True. Also assert the argv starts with `/usr/bin/osascript`, the script contains `default button "Cancel"`, and the message contains the spec's relative path, the branch, and `runs these commands on this machine now`.
  - `test_show_prints_summary_runs_nothing`: with an AC `touch sentinel.txt`, `run_acrun("show", "SPEC.md")` returns 0, its stdout contains `runs: touch sentinel.txt`, and `sentinel.txt` does not exist.
- [ ] **Step 3: Run them.** `python3 -m unittest scripts/tests/test_spec_loop.py -k ignores_stdin -k confirm -k show_prints` → FAIL (no `confirm`, no `show`).
- [ ] **Step 4: Implement.**
  - Factor the summary printing out of `cmd_approve` into `print_summary(spec, runnable)`.
  - Add `cmd_show`.
  - Replace the `sys.stdin.readline()` prompt with `confirm(spec, runnable)`, which builds the osascript command the way `agent-review` `confirm()` does: title `ac-run`, `giving up after 60`, `subprocess.run(..., timeout=75)`. The message lists the first 10 commands, then `+N more`.
  - Update `HUMAN` to `HUMAN ONLY (agents must not run this): approve in the session-band /gates pane, or ~/dotfiles/scripts/ac-run approve SPEC.md`, and the test's copy of the constant to match.
  - Register `show` in `main`.
- [ ] **Step 5: Run the whole file.** `python3 -m unittest scripts/tests/test_spec_loop.py` → all pass. Then `rg -n 'stdin=' scripts/tests/test_spec_loop.py` must show no call that reaches a subprocess `approve`.
- [ ] **Step 6: Commit.** `feat(ac-run): approve asks in a macOS dialog; add show`. The body explains that the approve test helper now runs in-process, because stdin no longer approves (a contract change from the approved design, not test gaming).

### Task 2: `gates.ts` discovery and status parsing

**Files:**
- Create: `session-band-plugin/hooks/gates.ts`, `session-band-plugin/hooks/gates.test.ts`

**Interfaces:**
- Consumes: `Worktree`, `parseWorktrees` from `./worktrees`; `PendingReview` from `./review`.
- Produces:
  - `type SpecState = 'draft' | 'approved' | 'stale' | 'invalid'`
  - `type SpecRow = { kind: 'spec'; key: string; worktree: string; branch: string; path: string; rel: string; state?: SpecState; error?: string }`. `key` is the absolute `path`.
  - `type ReviewRow = { kind: 'review'; key: string; worktree: string; branch?: string; review: PendingReview }`. `key` is `review:${runId}`.
  - `type GateRow = SpecRow | ReviewRow`
  - `specBranch(text: string): string | undefined`: the `branch:` value from front matter between the opening and closing `---`.
  - `specRows(tree: Worktree, files: readonly { rel: string; text: string }[]): SpecRow[]`. `rel` is `SPEC.md` or `specs/<name>.md`. Keeps only files whose branch equals `tree.branch`, and returns none for detached trees.
  - `parseSpecStatus(r: { exitCode: number; stdout: string; stderr: string }): { state: SpecState; error?: string }`, per Global Constraints.

- [ ] **Step 1: Write the failing tests.**
  - `specBranch` reads `branch: feat/x` and returns undefined with no front matter.
  - `specRows` keeps `SPEC.md` with `branch: feat/x` on tree branch `feat/x`, and drops it on `main` (Review Focus 4). It keeps a matching `specs/a.md`, and returns `[]` for a detached tree.
  - Two trees `/r` and `/r/.claude/worktrees/w`, each with a matching `SPEC.md`, give rows with distinct keys `/r/SPEC.md` and `/r/.claude/worktrees/w/SPEC.md` (Review Focus 2).
  - `parseSpecStatus`: `{0,'approved (record matches)'}` → approved; `{3,'draft (no record)'}` → draft; `{3,'stale (spec changed…)'}` → stale; `{2,'', 'SPEC.md:3: branch: is a, current branch is b\n'}` → invalid with that error line.
- [ ] **Step 2: Run them.** `claude plugin test .` → FAIL (module missing).
- [ ] **Step 3: Implement the four exports in `gates.ts`.**
- [ ] **Step 4: Run them.** `claude plugin test .` → PASS.
- [ ] **Step 5: Commit.** `feat(session-band): gates discovery and ac-run status parsing`

### Task 3: argv builders

**Files:**
- Modify: `session-band-plugin/hooks/gates.ts`, `gates.test.ts`

**Interfaces:**
- Produces, all pure, with `home` taken from `$.env.get('HOME')` by the caller:
  - `acRunArgv(home: string, sub: 'status' | 'show' | 'approve' | 'reject', spec: string): string[]` → `[`${home}/dotfiles/scripts/ac-run`, sub, spec]`
  - `approveTimeoutMs(runnable: number): number` → `(75 + 120 * runnable + 30) * 1000` (dialog give-up plus ac-run's default `--timeout` per AC plus slack)
  - `editRemoteArgv(socket: string, path: string): string[]` → `['nvim', '--server', socket, '--remote-send', `<C-\\><C-N>:edit ${vimEscape(path)}<CR>`]`, where `vimEscape` backslash-escapes space, `\`, `%`, `#`, `|` and `"`
  - Reused unchanged from `pane.tsx`, which already exports them: `approveArgv`, `approvalAction`, `reviewRemoteArgv`, `needsRejectConfirm`, `rejectToast`, `matchingSocket`, `reviewSplitArgv`, `reviewPaneRunArgv`

- [ ] **Step 1: Write the failing tests.**
  - `acRunArgv('/h','status','/r/SPEC.md')` equals `['/h/dotfiles/scripts/ac-run','status','/r/SPEC.md']`.
  - `approveTimeoutMs(2)` equals `345000`.
  - `editRemoteArgv('/s','/a b/SPEC.md')[4]` equals `'<C-\\><C-N>:edit /a\\ b/SPEC.md<CR>'` (Review Focus 1).
- [ ] **Step 2: Run them** → FAIL. **Step 3: implement.** **Step 4: run them** → PASS.
- [ ] **Step 5: Commit.** `feat(session-band): gates argv builders`

### Task 4: `/gates` pane with spec rows and actions

**Files:**
- Create: `session-band-plugin/hooks/gates.tsx`, `session-band-plugin/hooks/gates-pane.test.ts`
- Modify: `session-band-plugin/hooks/register.tsx` (import and call `register as registerGates`, beside `registerDraftPrs`), `session-band-plugin/hooks/pane-nav.ts` (append `'gates'` to `MOD_PANES`, and add `gates: 'Gates'` to `PANE_TITLES`), `session-band-plugin/hooks/pane-nav.test.ts` (the title test already covers the new id)

**Interfaces:**
- Consumes: Tasks 2 and 3; `nextPane` and `switchSteps` from `./pane-nav`; `PALETTE` from `./palette`.
- Produces: pane id `gates`, command `gates`, and the atom `{ plugin: 'session-band', key: 'gates' }` holding `{ rows: GateRow[]; selected?: string; detail?: string; busy: string[]; last: Record<string, string>; confirm?: string }`. Key-bar Button keys, which tests press: `gates-key-down`, `gates-key-up`, `gates-approve` (a), `gates-reject` (x), `gates-edit` (e), `gates-open` (o), `gates-key-reload` (r), `gates-key-prev` (b), `gates-key-next` (f), `gates-key-worktrees` (w), `gates-key-quit` (q).

Behaviour:
- **Opening** (`command.run` `gates` → `$.ui.open({ id: 'gates', title: 'Gates', focus: true })`; `ui.open` for `gates` → refresh).
- **Refresh:** `git worktree list --porcelain` from the session cwd. For each tree, read `SPEC.md` and list `specs/` with `$.fs.read`/`$.fs.list`, missing files tolerated. Then `specRows`, then `acRunArgv(home,'status',path)` with `cwd: tree.path` and `parseSpecStatus`, for every spec, in parallel. Review rows come from Task 5. Keep `selected` if its key still exists, else the first row.
- **Selecting a spec row** loads its detail with `acRunArgv(home,'show',path)` (cwd `tree.path`) and draws its stdout lines under the row.
- **Keys:** `j`/`k` move; `a` approve; `x` reject (second press to confirm, through `needsRejectConfirm` with the row key); `e` edit; `r` refresh; `b`/`f` with the `cycle` runner and `w` with `goTo($,'worktrees')`, copied from `draft-prs.tsx`; `q` close.
- **Approve on a spec row:** do nothing if `busy` holds the key, or the state is `invalid` or `approved`. Otherwise add the key to `busy`, run `acRunArgv(home,'approve',path)` with `cwd: tree.path` and `timeoutMs: approveTimeoutMs(n)` (`n` = the count of `runs:` lines in the detail; if the detail has not loaded, run `show` first and count from its output), store the last non-empty stdout or stderr line in `last[key]`, remove the key from `busy`, and refresh.
- **Reject on a spec row:** `acRunArgv(home,'reject',path)`, then refresh.
- **Edit:** a socket lookup copied from `pane.tsx` `socketFor`/`waitForSocket` (it cannot be imported), then `editRemoteArgv(socket, path)`. On failure, toast `Could not open the spec in Neovim.`
- **Rows:** grouped under a worktree header line (the branch, or the path basename for detached). A spec row reads `› ` for the selected row, then `rel`, two spaces, the state word coloured from `PALETTE` (approved green, draft yellow, stale and invalid red), then `approving…` while busy, else `last[key]` when set, else `error` for invalid rows.

- [ ] **Step 1: Write the failing kit tests** in the style of `draft-prs-pane.test.ts`, with `process.run` answered by argv: worktree porcelain for two trees, `fs.read` for `SPEC.md`, and `ac-run status` answers.
  - `/gates lists each worktree's matching specs with their state`: rows contain `SPEC.md  draft` and `SPEC.md  approved` under two branch headers.
  - `approve runs ac-run approve in the spec's worktree with a timeout`: press the `gates-approve` Button. The recorded call has argv `['/h/dotfiles/scripts/ac-run','approve','/r/w/SPEC.md']`, `cwd` `/r/w` and a numeric `timeoutMs`.
  - `a second approve while one runs starts no second process` (Review Focus 3): answer the first approve with a promise that you resolve after pressing twice. Exactly one approve call is recorded.
  - `invalid and approved specs do not approve`: no approve call is recorded.
  - `reject needs a second press`: one press runs nothing, and two presses run `ac-run reject`.
- [ ] **Step 2: Run them** → FAIL. **Step 3: implement `gates.tsx` and the register and pane-nav changes.** **Step 4: run them** → PASS, along with the whole suite.
- [ ] **Step 5: Commit.** `feat(session-band): /gates pane lists specs and approves through ac-run`

### Task 5: pending Pi reviews in `/gates`

**Files:**
- Modify: `session-band-plugin/hooks/gates.ts`, `gates.tsx`, `gates.test.ts`, `gates-pane.test.ts`

**Interfaces:**
- Produces: `reviewRows(tree: Worktree, records: readonly PendingReview[]): ReviewRow[]` in `gates.ts`.

Behaviour:
- **Refresh** reads `<tree.path>/.pi/agent-review/pending/*.json` for each tree, through `parsePending`, skipping undefined results.
- **Review row text:** `› `, then `review ${runId.slice(0,8)}`, two spaces, `${files.length} file(s)`.
- **`a` on a review row:** `approveArgv(home, runId)` with `cwd: tree.path` and `timeoutMs: 60_000`, then `approvalAction`, handled exactly as in `pane.tsx` `approve`. On `open-review`, open the review the way `o` does.
- **`o`:** the socket lookup, then `reviewRemoteArgv(socket,'AgentReview')`.
- **`x`:** second-press confirm, then `reviewRemoteArgv(socket,'AgentReviewRejectAll',runId)` and `rejectToast`.
- **`e`** does nothing on a review row.

- [ ] **Step 1: Write the failing tests.**
  - `reviewRows` maps two records to keys `review:<id>`.
  - Malformed JSON is skipped: `fs.read` returns `{"runId":` and no row appears, with no throw (Review Focus 5).
  - Pane: `a` on a review row runs `['/h/dotfiles/scripts/agent-review','approve',id]` with `cwd` set to that worktree.
- [ ] **Step 2: Run them** → FAIL. **Step 3: implement.** **Step 4: run them** → PASS, along with the whole suite.
- [ ] **Step 5: Commit.** `feat(session-band): pending Pi reviews in /gates`

### Task 6: docs and the live gate hand-off

**Files:**
- Modify: `README.md` (the ac-run section ~:205-210): approval is now in `/gates` or `ac-run approve`, both through a macOS dialog; add `ac-run show`.
- Do not modify `shared/AGENTS.md`. Its spec-loop rule block is static.

- [ ] **Step 1: Update the README** section in clear prose.
- [ ] **Step 2: Run all checks.** `python3 -m unittest scripts/tests/test_spec_loop.py`, `cd session-band-plugin && claude plugin test .`, and `~/dotfiles/scripts/floor-guard`. All must be clean; paste the outputs.
- [ ] **Step 3: Commit.** `docs: approve specs from /gates`
- [ ] **Step 4: Push the branch and open a draft PR.** Its body lists the live checks a human must run, because an agent cannot click the dialog:
  1. `/gates` in a session with two worktrees holding draft specs lists both.
  2. Approve shows the dialog; Cancel leaves the spec draft; Approve makes it approved.
  3. `echo y | ~/dotfiles/scripts/ac-run approve SPEC.md` shows the dialog and does not approve on its own.
  4. Reject needs two presses.
  5. Edit opens the spec in Neovim.
  6. A pending Pi review appears and approves through agent-review's dialog.
