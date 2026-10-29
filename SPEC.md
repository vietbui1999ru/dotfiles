---
status: approved
branch: worktree-wfbench
---
# SPEC: Benchmark harness for three review workflows (pilot)

## Objective
Measure how much human steering, review retry and test-loop iteration each agent workflow needs, and how good its final code is, before changing the review architecture or its token spend. Success: the pilot (2 tasks x 4 arms x 2 runs = 16 runs) produces one per-run event log and one blind-graded result per run, and `bench report` prints per-arm counts and grades from those files alone.

Background and sources: `docs/plans/2026-10-29-workflow-bench-research.md`.

### Decisions
- D1: Arms. `council`: Pi implements, then the council reviews (acceptance gpt-6.1-sol, code quality and style deepseek-v4-pro, security veto glm-5.3), every voice at `medium`. `single-gpt`: Pi implements, then `openai-codex/gpt-6.1-sol:medium` alone reviews. `single-deepseek`: Pi implements, then `opencode-go/deepseek-v4-pro:medium` alone reviews. `send-it`: the send-it rule as written, a separate baseline whose steering counts are not compared.
- D2: Only the review stage differs between `council`, `single-gpt` and `single-deepseek`. Implementer model, task input, loop rules and reviewer input are identical across them.
- D3: Reviewer input in every review arm is the diff plus the task's SPEC.md acceptance criteria. No transcript, plan or implementer notes. Each reviewer returns structured findings: one JSON object per finding with `file`, `line`, `severity`, `ac` (id or null) and `failure_scenario`, plus a `verdict` of `pass` or `fail`.
- D4: Each review is a fresh `pi -p ... --no-session --no-extensions --no-skills` process started by the harness at a fixed step, never by model delegation. The reviewer prompts are versioned files under `scripts/bench/prompts/`.
- D5: Loop: Pi applies review fixes; at most 3 review rounds; a run stops on `pass`, on a round with only `nit` findings, or at the cap.
- D6: Tasks are the archived specs `docs/specs/2026-10-21-safety-block-log.md` and `docs/specs/2026-10-20-nvim-review-dashboard.md`. Each run starts in a fresh worktree at the parent of the task's first implementation commit, with the archived SPEC.md copied in as the approved input. No grill.
- D7: Per-run log `bench/runs/<run-id>/events.jsonl`, one object per event with `ts`, `type` and `detail`. Types: `steer`, `review_round`, `finding`, `test_iteration`, `reject`, `note`. `steer` is derived from every user message after the first in the run's Pi session; `review_round` and `finding` from the harness's reviewer calls; `test_iteration` from post-run-verifier repair loops. `bench log <run-id> <type> <text>` records anything outside Pi.
- D8: Grading. `bench anonymize` gives each run's final diff and findings a random id, shuffles the order and writes the id-to-run map to a sealed file that `bench report` reads only after grades exist. The human grades a rubric (correctness against ACs, readability, unrequested scope, over-defensive additions) and classifies each finding as `real`, `nit`, `stale` or `wrong`. `opencode-go/qwen3.8-max` grades the same items through `pi -p --no-session --no-extensions --no-skills`.
- D9: `bench report` prints, per arm: mean and spread of steer, review_round, test_iteration and reject counts; finding classification counts; mean rubric scores from both graders; tokens per run where the Pi session records them.
- D10: `scripts/bench` is Python, standard library only, tested in `scripts/tests/test_bench.py`.

## Acceptance Criteria
- AC-1: `bench prepare <task> <arm> <run>` creates a worktree at the task's base commit with the archived SPEC.md at its root and an empty events log
  verify: `python3 -m unittest scripts.tests.test_bench.Prepare.test_worktree_at_base_with_spec`
- AC-2: The three review arms read the same implementer model and loop settings; only the reviewer entry differs
  verify: `python3 -m unittest scripts.tests.test_bench.Arms.test_review_arms_differ_only_in_reviewer`
- AC-3: The reviewer call passes the diff and the AC list, includes no transcript or plan text, and runs pi with `--no-session --no-extensions --no-skills`
  verify: `python3 -m unittest scripts.tests.test_bench.Review.test_reviewer_input_and_flags`
- AC-4: Reviewer output is parsed into findings with every D3 field; malformed output is recorded as a `note` event and counts as a failed round
  verify: `python3 -m unittest scripts.tests.test_bench.Review.test_parse_findings`
- AC-5: The loop stops on pass, on nit-only findings, or after 3 rounds, and logs one `review_round` event per round
  verify: `python3 -m unittest scripts.tests.test_bench.Loop.test_stop_conditions`
- AC-6: `steer` events are derived from user messages after the first in a fixture Pi session
  verify: `python3 -m unittest scripts.tests.test_bench.Collect.test_steer_from_session`
- AC-7: `bench log` appends one event with `ts`, `type` and `detail`; an unknown type exits 2 and writes nothing
  verify: `python3 -m unittest scripts.tests.test_bench.Log.test_append_and_reject_unknown`
- AC-8: `bench anonymize` output contains no arm name or run id, and the id map is written only to the sealed file
  verify: `python3 -m unittest scripts.tests.test_bench.Anonymize.test_no_arm_leak`
- AC-9: `bench report` refuses to unseal before both graders' grades exist, then prints per-arm counts, finding classes and rubric means
  verify: `python3 -m unittest scripts.tests.test_bench.Report.test_sealed_until_graded scripts.tests.test_bench.Report.test_per_arm_summary`
- AC-10: Live review-gate files are unchanged by this branch
  verify: `/usr/bin/git diff --quiet main -- shared/skills/delegate-pi/pi-evaluator.sh shared/skills/delegate-pi/pi-council.sh shared/skills/delegate-pi/pi-router.sh scripts/agent-review pi/.pi/agent/extensions`
- AC-11: Existing script tests still pass
  verify: `python3 -m unittest discover -s scripts/tests`
  baseline: pass
- AC-12: The pilot's 16 runs complete with an events log and two graders' grades each
  verify: manual - the runs need a human steering live

## Boundaries
### Always
- Run `~/dotfiles/scripts/ac-run check SPEC.md` before claiming done
- Invoke reviewers from the harness at a fixed step, never through model delegation
### Ask first
- Running anything beyond the 16 pilot runs
- Changing an arm's model, effort or reviewer prompt after the first run
### Never
- Edit the live review gate (`pi-evaluator.sh`, `pi-council.sh`, `pi-router.sh`, `scripts/agent-review`, Pi review extensions); the benchmark uses its own copies
- Read the sealed id map before both graders finish
- Edit a `verify:` line or a test to make a check pass

## Open Questions
- Implementer model for the three review arms? Default: `opencode-go/claude-haiku-5-5:off` (the high tier) for all three.
- send-it builds with the Claude Haiku worker, not Pi; keep it as is or force Pi? Default: as written, recorded as a confound.
- Where does Pi store the session for `--session-id pueue-<slug>`, and does it record tokens? Default: locate it in the first build step; tokens marked unavailable if absent.
- How is the council run at medium without touching `routing.env`? Default: the harness sets the `PI_COUNCIL_*` variables per call through a bench-local routing file (`PI_ROUTING_FILE`).
- Which commit is a task's base? Default: the parent of the first commit on the task's branch that touches non-spec files.
