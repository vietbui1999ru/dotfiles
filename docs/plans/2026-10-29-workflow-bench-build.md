# Build plan: workflow benchmark harness

Implements the approved `SPEC.md` (branch `worktree-wfbench`, 12 ACs). Work only toward its AC ids and obey
its Boundaries. Background: `docs/plans/2026-10-29-workflow-bench-research.md`.

## Hard constraints

- Never edit the live review gate: `shared/skills/delegate-pi/pi-evaluator.sh`, `pi-council.sh`,
  `pi-router.sh`, `scripts/agent-review`, anything under `pi/.pi/agent/extensions`. AC-10 checks this.
- Never edit `SPEC.md`, a `verify:` line, or an existing test.
- Python standard library only. No network or model calls in tests: every model call goes through one
  function that runs the command named by `BENCH_PI_BIN` (default `pi`), and tests point it at a fake
  script under `scripts/tests/fixtures/bench/`.
- Commit after each step below, staging files by path.

## Resolved open questions (from the spec)

- Implementer for the three review arms: `opencode-go/claude-haiku-5-5:off`.
- send-it: run as written; the harness only prepares, logs and collects it. Record "Claude Haiku worker,
  not Pi" as a confound in `scripts/bench/arms.json`.
- Pi sessions live at `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<session-id>-<hex>.jsonl`. Each
  line is JSON. Human messages are `{"type":"message","message":{"role":"user",...}}`. Assistant
  messages carry `message.usage.totalTokens` and `message.usage.cost`. Extension injections are
  `type: custom_message` and are never steering.
- Council at medium: the harness writes a bench-local routing file and passes it as `PI_ROUTING_FILE`;
  `~/.pi/agent/routing.env` is never touched.
- Task base commits (dotfiles `main`):

| Task id | Archived spec | Base | Reference diff |
|---|---|---|---|
| `safety-block-log` | `docs/specs/2026-10-21-safety-block-log.md` | `18a6b81^` | `18a6b81` |
| `nvim-review-dashboard` | `docs/specs/2026-10-20-nvim-review-dashboard.md` | `88abc37^` | `88abc37` + `9bbb8c3` |

## Layout

- `scripts/bench` — executable entry point (`#!/usr/bin/env python3`), thin: imports `scripts/bench_lib/`.
- `scripts/bench_lib/` — modules: `arms.py`, `prepare.py`, `review.py`, `loop.py`, `collect.py`,
  `events.py`, `anonymize.py`, `report.py`.
- `scripts/bench/` cannot be both a file and a directory: put data in `scripts/bench_data/`:
  `arms.json`, `tasks.json`, `prompts/review-single.md`, `prompts/review-voice.md` (takes a dimension),
  `prompts/judge.md`.
- `scripts/tests/test_bench.py` — test classes named exactly as the spec's verify lines:
  `Prepare`, `Arms`, `Review`, `Loop`, `Collect`, `Log`, `Anonymize`, `Report`.
- Run data: `bench/runs/<run-id>/` (`events.jsonl`, `findings-<round>.json`, `final.diff`, `meta.json`).
  Run worktrees: `${BENCH_WORKTREES:-$HOME/.cache/wf-bench}/<run-id>`. Run id: `<task>-<arm>-<n>`.

## Behaviour per component

1. **arms.json** (AC-2). Four arms: `council`, `single-gpt`, `single-deepseek`, `send-it`. Shared keys for
   the three review arms (`implementer`, `max_rounds: 3`, `reviewer_input: ["diff","acs"]`) live in a
   `review_defaults` object; each review arm adds only `reviewer`. `council.reviewer` lists voices
   `acceptance-criteria` gpt-6.1-sol, `code-quality` deepseek-v4-pro, `style` deepseek-v4-pro and veto
   `security` glm-5.3, all `:medium`; single arms name one model at `:medium`. The AC-2 test loads the
   resolved arm configs and asserts that removing `reviewer` makes the three equal.
2. **prepare** (AC-1). `bench prepare <task> <arm> <n>`: `git worktree add --detach <path> <base>`, copy the
   archived spec to `<path>/SPEC.md` with `status: approved`, create `bench/runs/<run-id>/events.jsonl`
   empty, write `meta.json` (task, arm, base, created ts). Prints the Pi dispatch command to run (pueue,
   `pi-view --tui`, `--session-id bench-<run-id>`, model from the arm) but does not run it. Test uses a
   temporary git repo.
3. **review** (AC-3, AC-4). `bench review <run-id>`: diff = `git -C <worktree> diff <base>` (include
   untracked files via `git add -N`). ACs = the `- AC-n:` lines of the worktree's SPEC.md. Prompt =
   prompt file + ACs + diff; nothing else. Single arm: one call. Council: the three voices, then the veto;
   verdict is `fail` if a majority of the three fail or the veto fails; findings are the union. Each call:
   `$BENCH_PI_BIN --model <m> -p <prompt> --no-session --no-extensions --no-skills`, with
   `PI_ROUTING_FILE` set to the bench routing file. Output must be a JSON object
   `{"verdict":"pass|fail","findings":[{file,line,severity,ac,failure_scenario}]}`; `severity` is
   `blocker|major|minor|nit`. Malformed output: log a `note` event and treat the round as `fail` with no
   findings. Logs one `review_round` and one `finding` per finding; writes `findings-<round>.json` and a
   `REVIEW.md` in the worktree whose first line is `[bench-review]`, for the human to paste to Pi.
4. **loop** (AC-5). Pure function `next_action(rounds) -> "continue"|"stop:pass"|"stop:nits"|"stop:cap"`;
   `bench review` calls it and prints the result. `max_rounds` from the arm.
5. **collect** (AC-6). `bench collect <run-id>`: find the session file whose name contains
   `bench-<run-id>`; every `role: user` message after the first is a `steer` event unless its text starts
   with `[bench-review]`; sum `usage.totalTokens` and `usage.cost` into `meta.json`. Writes `final.diff`.
   Idempotent: rerunning replaces derived events, keeps manual ones (`source: manual` vs `derived`).
   Fixture session file in `scripts/tests/fixtures/bench/`.
6. **log** (AC-7). `bench log <run-id> <type> <text>`; types from the spec's D7 list; unknown type exits 2
   and writes nothing.
7. **anonymize** (AC-8). `bench anonymize`: for every run with `final.diff`, emit `bench/grading/<id>/`
   (diff, findings with model names stripped) with a random 8-hex id, shuffled; write the id-to-run map
   to `bench/grading/.sealed-map.json` only. Writes a `grades-template.json` per item with rubric fields
   and per-finding class slots (`real|nit|stale|wrong`) for `human` and `judge`.
   `bench judge` fills the `judge` half with `opencode-go/qwen3.8-max` via the same call function.
8. **report** (AC-9). `bench report`: exit 2 with a message if any item lacks either grader's grades;
   otherwise unseal and print per arm: mean and min-max of steer, review_round, test_iteration, reject;
   finding class counts; rubric means per grader; tokens and cost. Plain text table.

`test_iteration` events: derive from the run's post-run-verifier output if it is found in the Pi session;
if no reliable marker exists, leave them to `bench log` and say so in the commit message. Do not modify
the verifier.

## Steps (commit after each)

1. `arms.json`, `tasks.json`, `events.py`, `log` subcommand + `Arms`, `Log` tests.
2. `prepare` + `Prepare` test.
3. Prompts, `review`, `loop` + `Review`, `Loop` tests.
4. `collect` + fixture + `Collect` test.
5. `anonymize`, `judge`, `report` + `Anonymize`, `Report` tests.
6. A short `docs/workflows/workflow-bench.md`: how one run goes end to end (prepare, dispatch Pi, review
   rounds via REVIEW.md, collect, anonymize, grade, judge, report).

## Verification

- `python3 -m unittest discover -s scripts/tests` passes (89 existing tests plus the new ones).
- `~/dotfiles/scripts/ac-run check SPEC.md` — all ACs pass except AC-12 (manual).
- `~/dotfiles/scripts/floor-guard` clean.
- Report the exact failing output if any check still fails after 3 tries.
