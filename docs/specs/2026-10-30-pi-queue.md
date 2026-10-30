---
status: approved
branch: feat/pi-queue
---
# SPEC: A predicted work queue in pueue, released by mechanical waits

## Objective
Remove the human from routine waiting: noticing a merge, noticing a finished run, typing "done" so the next step starts. The planner writes the agreed sequence of steps into pueue. Small fact-checking wait tasks release each step when its fact holds. The 3 human gates (spec approve, review approve, merge) stay human. Success: after the human merges a PR or approves a spec, the next agreed step starts with no message to Claude, and every wait and step is visible in `pueue status` and logged per workflow for the benchmark.

Decisions from the 2026-10-30 grill:
1. Commandr's `.agents/` task bus is retired; `.agents/sessions/` stays.
2. pueue is the only record of the queue: labels `q:<session>:<template>:<step>`, with longer text in brief files.
3. Future steps are added with `pueue add --stashed`. A wait task runs `pi-wait <fact> … --release <id…>` and enqueues them when the fact holds. No `--after`, no daemon.
4. Spec approve, review approve and merge stay human (send-it keeps its auto-merge).
5. Released steps follow the allow-list in Boundaries, and may queue new steps only from a template.
6. Judgment steps with no live Claude session wait and notify. Each step can opt into `fallback: sonnet`; `fallback: opus` exists but is not a default.
7. Each step has one of 3 executors: `shell`, `pi` (with a model) or `claude` (with a fallback).
8. A cheap guard refuses to dispatch into a worktree where pueue already runs a task; `wt` replaces it later.
9. Failed-command and guard-refusal reporting is a separate follow-up.
10. Every wait and step event is appended to an events log, tagged by workflow.

## Acceptance Criteria
- AC-1: `pi-wait pr-merged <n>` exits 0 and enqueues its `--release` ids once `gh pr view <n>` reports MERGED, and exits non-zero without enqueueing when the PR is CLOSED unmerged or the timeout passes
  verify: `python3 scripts/tests/test_pi_wait.py PiWait.test_pr_merged`
- AC-2: `pi-wait spec-approved <SPEC path>` releases its ids once `ac-run status` reports approved, and never writes an approval record itself
  verify: `python3 scripts/tests/test_pi_wait.py PiWait.test_spec_approved`
- AC-3: `pi-wait outcome <task id> <outcome>` releases its ids once `pi-outcome <task id> --json` reports that outcome, and fails without releasing on `failed`, `killed` or exhausted checks
  verify: `python3 scripts/tests/test_pi_wait.py PiWait.test_outcome`
- AC-4: `pi-wait review-decided <worktree> <runId>` releases its ids once that run's pending record under `.pi/agent-review/pending/` is gone, watching only the agent-review ledger
  verify: `python3 scripts/tests/test_pi_wait.py PiWait.test_review_decided`
- AC-5: `pi-wait` refuses to run, with a usage error, when `--release` has no explicit task ids, so a bare `pueue enqueue` can never release every stashed task
  verify: `python3 scripts/tests/test_pi_wait.py PiWait.test_requires_explicit_ids`
- AC-6: `pi-queue add <template> key=value… [workflow=…]` expands each of the 5 templates (pr-merge, spec-approved, pi-run-done, review-decided, checks-exhausted) into stashed steps plus wait tasks in the `waits` group, labelled `q:<session>:<template>:<step>`, and prints the created ids
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_templates_expand`
- AC-7: Every template step names exactly one executor: `shell` runs its command with no model, `pi` dispatches through `pi-view` with the model the template names, `claude` runs a brief file
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_executor_per_step`
- AC-8: A `claude` step types its brief into the live Claude session's herdr pane when that session's pane is idle, and otherwise notifies through herdr and keeps waiting; with `fallback: sonnet` it runs `claude -p --model sonnet` instead of waiting
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_claude_step_routing`
- AC-9: A `pi` step refuses to dispatch, and fails without starting Pi, when pueue already has a running task whose working directory is the same worktree
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_worktree_guard`
- AC-10: A released step can queue new steps only through `pi-queue add` with a known template; an unknown template name is refused
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_unknown_template_refused`
- AC-11: Every wait and step event (released, failed, notified, picked up) appends one JSON line to `~/.local/state/pi-queue/events.jsonl` with time, session, workflow, template, step, executor and, for Pi steps, the check round
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_event_log`
- AC-12: Wait tasks run in a pueue group named `waits` that the queue creates when missing, so they never take the default group's Pi slots
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_waits_group`
- AC-13: Commandr's task bus is unhooked: `shared/agent-workflow.default.json` has `"commandr": false`, no Claude hook calls a Commandr adapter, session-band no longer reads `.agents/claimed/`, and `shared/AGENTS.md` no longer calls Commandr the task service
  verify: `python3 scripts/tests/test_pi_queue.py PiQueue.test_commandr_unhooked`
- AC-14: The `/pi` Monitor shows a session's queued waits and steps grouped by session label, in queue order
  verify: manual - visual check of the session-band pane
- AC-15: Existing script and plugin tests still pass
  verify: `node --test scripts/*.test.mjs`
  baseline: pass

## Boundaries
### Always
- Release only explicit task ids; read gate records, never write them
- Dispatch Pi only through `pueue-safe` and `pi-view`
- Run `~/dotfiles/scripts/ac-run check SPEC.md` and `~/dotfiles/scripts/floor-guard` before claiming done
### Ask first
- New dependencies; changes to gate code (reference-transaction hook, ac-run, agent-review, pueue-safe)
- Deleting the ~/repos/Commandr folder (after AC-13 lands)
### Never
- Automatically push to main, merge, approve a spec or review, force-push, delete branches, `reset --hard` or `pueue clean`
- Queue free-form steps outside a template
- Edit a verify line or a test to make a check pass

## Open Questions
- How is a live Claude session found for AC-8? Default: herdr `pane list` with `agent == claude` and `agent_session` equal to the session id stored in the step's label, typing only when `agent_status` is idle.
- Where do template definitions live? Default: one data file next to `scripts/pi-queue`, tested through `pi-queue`.
- Wait timeout and poll interval? Default: 10 s polls, 24 h timeout, both per template.
- Logging guard refusals (reference-transaction) to safety-log? Default: separate follow-up, not this spec.
- Swap the worktree guard for `wt` once it exists? Default: yes, as a later 1-line change.
- `fallback: opus` for judgment steps? Default: supported, unused, for a return to the Max plan.
