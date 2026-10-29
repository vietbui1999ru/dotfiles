# Workflow benchmark: one run, end to end

The harness at `scripts/bench` measures how much human steering, review retry and test-loop iteration each
review workflow needs, and how good its final code is. Spec: `SPEC.md` (archived under `docs/specs/`).
Background: `docs/plans/2026-10-29-workflow-bench-research.md`.

Everything is Python standard library. No step calls a model except `review`, `judge` and the Pi dispatch
you run yourself, and tests never call a model: they point `BENCH_PI_BIN` at
`scripts/tests/fixtures/bench/fake-pi`.

## Arms and tasks

- Arms (`scripts/bench_data/arms.json`): `council`, `single-gpt`, `single-deepseek`, `send-it`. The three
  review arms differ only in their `reviewer` entry.
- Tasks (`scripts/bench_data/tasks.json`): `safety-block-log`, `nvim-review-dashboard`. Each run starts at the
  task's base commit with the archived spec copied in as `SPEC.md`.

## One run

Run id: `<task>-<arm>-<n>`, for example `safety-block-log-council-1`.

1. **Prepare.** Creates the worktree and prints the Pi command. It does not run it.

   ```sh
   scripts/bench prepare safety-block-log council 1
   ```

   The worktree is under `${BENCH_WORKTREES:-$HOME/.cache/wf-bench}/<run-id>`. It holds `SPEC.md`
   (status `approved`), and `bench/runs/<run-id>/` holds an empty `events.jsonl` and `meta.json`.

2. **Dispatch Pi.** Run the printed `pueue add ... -w <worktree> -- '.../pi-view --tui pi --model
   <implementer> --session-id bench-<run-id> -p <first message> < /dev/null'` command. The first message
   is the same fixed text in every arm. Pi implements the spec in that worktree. Steer it live as you
   normally would. Each of your messages after the first is captured later as a `steer` event. For the
   send-it arm the command prints an instruction instead: start Claude in the worktree with send-it on
   and the same first message.

3. **Review rounds.** When Pi says it is done, run the reviewer from the harness:

   ```sh
   scripts/bench review <run-id>
   ```

   This writes `findings-<n>.json`, logs a `review_round` and one `finding` per finding, and writes
   `REVIEW.md` in the worktree. The first line of `REVIEW.md` is `[bench-review]`. The command prints
   `stop:passed`, `stop:nits`, `stop:cap` or `continue`. On `continue`, paste the contents of `REVIEW.md`
   into the same Pi session; Pi applies the fixes, and you run `review` again. The loop stops at a pass,
   at nit-only findings, or after 3 rounds.

4. **Log what happens outside Pi.** Test-loop iterations from the post-run verifier, and any rejected
   change, are recorded by hand:

   ```sh
   scripts/bench log <run-id> test_iteration "ran ac-run check, one failure fixed"
   scripts/bench log <run-id> reject "dropped the helper Pi added"
   ```

   Unknown types exit 2 and write nothing.

5. **Collect.** When the run settles:

   ```sh
   scripts/bench collect <run-id>
   ```

   This finds the Pi session named `bench-<run-id>` under `~/.pi/agent/sessions/`, derives `steer` events
   from user messages after the first (skipping `[bench-review]` messages and extension injections), sums
   token and cost usage into `meta.json`, and writes `final.diff`. It is idempotent: rerunning replaces the
   derived events and keeps manual ones.

## Grading

Run these once every run in the pilot is collected.

6. **Anonymize.** Writes one blind item per run under `bench/grading/<random-id>/` with the diff and the
   findings, scrubbed of arm, run and model names, and shuffled:

   ```sh
   scripts/bench anonymize
   ```

   The id-to-run map is written only to `bench/grading/.sealed-map.json`.

7. **Grade by hand.** Fill the `human` half of each item's `grades-template.json`: the four rubric scores
   (correctness, readability, unrequested_scope, over_defensive, each 1-5) and each finding as `real`,
   `nit`, `stale` or `wrong`. Do not open `.sealed-map.json` yet.

8. **Judge.** The second grader, `opencode-go/qwen3.8-max`, fills the `judge` half through the same pi
   call:

   ```sh
   scripts/bench judge
   ```

9. **Report.** Refuses until both graders have graded every item, then unseals and prints per arm the
   counts (steer, review_round, test_iteration, reject), finding class counts, rubric means for each
   grader, and tokens and cost:

   ```sh
   scripts/bench report
   ```

## Confounds to keep in mind

- `send-it` builds with a Claude Haiku worker, not Pi, and its review and auto-merge run outside the
  harness. It is a baseline; compare its steer counts with care.
- The implementer for the three review arms is `opencode-go/claude-haiku-5-5:off`.
- The council runs at `medium` through `PI_ROUTING_FILE=bench/routing.env`, so `~/.pi/agent/routing.env` is
  never touched.
- `test_iteration` events are logged by hand from the verifier output. The harness does not parse the
  post-run verifier, and does not modify it.
